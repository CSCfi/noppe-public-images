# noppe-public-images

Images for noppe.csc.fi that are publicly available. Each image is contained in its own subdirectory.

## Building locally

Build image in subdirectory with podman:
```shell
cd jupyter-minimal
podman build --pull=true -t $(basename $(pwd)) .
```

Build image for amd64 architecture on ARM (say, Mac M1/M2):
```shell
cd jupyter-minimal
podman build --platform linux/amd64 --pull=true -t $(basename $(pwd)) .
```

