# Autosubsync pretrained model

`trained-model.json` is the unmodified JSON model distributed in the upstream
`autosubsync==1.0.1` wheel. The Git repository excludes `trained-model.bin` and
the training media are not supplied. The Docker build copies this data into
the Git checkout before building the engine; no released engine code is
installed from the wheel.

- Upstream: https://github.com/oseiskar/autosubsync
- Release: https://pypi.org/project/autosubsync/1.0.1/
- Wheel: `autosubsync-1.0.1-py2.py3-none-any.whl`
- Wheel SHA-256: `2c94b35c8d49515bafcc3d6bce676cf06a3fd81b9bacdc96640e34ea7d760ab2`
- Model SHA-256: `783f1c9c6a53cb48585974691c992ad762fdbd58caf468716d20bc5915e44063`
- Model size: 2533 bytes
- License: MIT; see `LICENSE.txt`.
