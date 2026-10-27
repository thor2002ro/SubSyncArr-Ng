"""Run SubSync concurrently while protecting its shared model cache."""
import fcntl
import os
import sys
import threading
from pathlib import Path


def main():
    args = sys.argv[1:]
    notify_ready = args[0] == '--notify-ready'
    if notify_ready:
        args = args[1:]
    lock_path = Path(args[0])
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as cache_lock:
        # Import and initialize upstream only after gaining read access: its
        # asset manager reads the on-disk catalog and model descriptors lazily.
        fcntl.flock(cache_lock, fcntl.LOCK_SH)
        from subsync import cli
        from subsync.assets import assetManager
        from subsync.assets.item import Asset
        from subsync.assets.mgr import AssetManager
        from subsync.__main__ import subsync

        download_assets = cli.AssetsDownloader.run
        remove_local_data = Asset._removeLocalData
        exclusive = False
        cleanup_lock = threading.RLock()
        cache_generation = 0

        def identity(path):
            try:
                stat = os.stat(path)
                return (stat.st_dev, stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
            except OSError:
                return None

        def remove_with_write_lock(asset):
            nonlocal cache_generation
            # Upstream's apparent reads can remove malformed descriptors or
            # dictionaries. Preserve that repair behavior, but exclude readers.
            with cleanup_lock:
                if exclusive:
                    return remove_local_data(asset)
                before = identity(asset.path)
                fcntl.flock(cache_lock, fcntl.LOCK_EX)
                try:
                    if identity(asset.path) != before:
                        # Lock conversion releases shared access. An installer
                        # may have repaired this asset while we waited.
                        try:
                            asset._local = asset._readLocalData() or {}
                            return
                        except Exception:
                            pass
                    return remove_local_data(asset)
                finally:
                    fcntl.flock(cache_lock, fcntl.LOCK_SH)
                    cache_generation += 1

        Asset._removeLocalData = remove_with_write_lock

        def ensure_assets(self, tasks):
            nonlocal exclusive, cache_generation
            if not assetManager().getAssetsForTasks(tasks).notInstalled():
                return True

            # Queue installers without holding a read lock. Once the first
            # installer finishes, others can recheck under shared access and
            # join its alignment immediately instead of waiting for it to end.
            fcntl.flock(cache_lock, fcntl.LOCK_UN)
            with Path(str(lock_path) + '.install').open('a') as install_lock:
                fcntl.flock(install_lock, fcntl.LOCK_EX)
                fcntl.flock(cache_lock, fcntl.LOCK_SH)
                AssetManager._instance = None
                if not assetManager().getAssetsForTasks(tasks).notInstalled():
                    return True

                # Only this installer can request write access. Active readers
                # retain their models until alignment ends.
                fcntl.flock(cache_lock, fcntl.LOCK_EX)
                exclusive = True
                try:
                    if not download_assets(self, tasks):
                        return False
                    # Upstream's successful return alone does not prove that
                    # every required descriptor was installed and is readable.
                    AssetManager._instance = None
                    if assetManager().getAssetsForTasks(tasks).notInstalled():
                        print('SubSync download did not install all required assets', file=sys.stderr)
                        return False
                    return True
                finally:
                    exclusive = False
                    fcntl.flock(cache_lock, fcntl.LOCK_SH)
                    cache_generation += 1

        def prepare_and_notify(self, tasks):
            while True:
                generation = cache_generation
                if not ensure_assets(self, tasks):
                    return False
                if generation == cache_generation:
                    break
                # Cleanup may have released shared access while another writer
                # updated a different required asset. Refresh every descriptor,
                # and require one successful pass without lock conversion.
                AssetManager._instance = None
            if notify_ready:
                os.write(3, b'ready\n')
            return True

        cli.AssetsDownloader.run = prepare_and_notify
        # Retain shared access until alignment ends; writers cannot replace a
        # model or dictionary that another process is currently using.
        return subsync(args[1:])


if __name__ == '__main__':
    sys.exit(main())
