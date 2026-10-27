"""Translate ffsubsync's structured sync result into a reliable process exit."""
import sys

from ffsubsync.ffsubsync import make_parser, run


def main():
    result = run(make_parser().parse_args())
    retval = result.get("retval", 1)
    if retval:
        return int(retval)
    if result.get("sync_was_successful") is not True:
        print("ffsubsync did not report successful synchronization", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
