# Noppe CLI Engine

This directory contains the Docker engine for the Noppe CLI learning environment. It provides the container image that
powers the browser-based learning platform: a web UI with rendered course content on the left and a live Linux terminal
on the right.

The course content itself lives in a separate repository
(e.g. [csc-training/noppe-cli](https://github.com/csc-training/noppe-cli)) and is loaded into the container at runtime —
you do not need to rebuild the image to update or swap course material.

## Building and running

```bash
docker build -t noppe-learning .
docker run -p 8787:8787 noppe-learning
```

Open `http://localhost:8787` in a browser. By default the container shows a placeholder page. To load your own course
content, see the content repository section below.

The password is set at runtime:

```bash
docker run -p 8787:8787 -e PASSWORD=mypassword noppe-learning
```

If no `PASSWORD` is set, one is generated at startup, written to the container log and substituted into the course
content wherever `{{PASSWORD}}` appears.

The account name is set at build time, not at runtime:

```bash
docker build --build-arg USERNAME=myuser -t noppe-learning .
```

Noppe seeds the session volume from the image's own `/home/$USERNAME`, so the name has to be baked in rather than
changed on start.

## Linking course content at runtime

When the container starts, it looks for a `manifest.json` in `/home/$USERNAME/noppe-cli`, or in the directory named by
`CONTENT_DIR` if that is set. If it finds one, the startup script substitutes template variables in all Markdown
files and symlinks that directory to the web server's content root — no rebuild needed. Either way the chosen
directory is named in the container log.

The container itself has no cloning logic — it simply checks whether the directory is present when it starts. In Noppe,
the platform takes care of cloning the content repository into the container before the startup script runs; this
happens behind the scenes and is not part of the container build or startup scripts. The directory name in the container
matches the repository name, whatever that name is.

For local development you can bind-mount your content repository to the expected path:

```bash
docker run -p 8787:8787 \
  -e PASSWORD=secret \
  -v /path/to/your/content-repo:/home/user/noppe-cli \
  noppe-learning
```

The content repository must follow the structure described in its own README (a `manifest.json` at the root and one
directory per topic).

### Using a differently-named repository

Noppe clones the content repository under its own name, so a repository called `my-training` arrives at
`/home/$USERNAME/my-training`. Set `CONTENT_DIR` to that name — no rebuild, no fork of this repository:

```bash
docker run -p 8787:8787 \
  -e PASSWORD=secret \
  -e CONTENT_DIR=my-training \
  -v /path/to/your/content-repo:/home/user/my-training \
  noppe-learning
```

In Noppe, set `CONTENT_DIR` in the application's `environment_vars`, alongside `USERNAME` and `PASSWORD`.

`CONTENT_DIR` is a directory name, not a path: it is always looked up inside `/home/$USERNAME`. Anything containing a
slash, starting with a dot, or using characters outside `A-Za-z0-9._-` is refused and logged, because the template
substitution rewrites that directory as root.

## Adding software to the container

All OS-level software is installed by `configs/install_os_sw.sh`, which runs once at image build time. To make
additional tools available in the terminal for your course, edit this script before building.

The script installs packages with `apt-get` and also builds several tools from source (Slurm, OpenMPI, PMIx). Version
numbers for those are defined as variables at the top of the script:

```bash
SLURM_VER="24.05.8"
PMIX_VER="4.2.9"
OPENMPI_VER="4.1.4"
```

### Adding an apt package

Add the package name to the `apt-get install -y` block:

```bash
apt-get install -y \
    ...
    your-package-here
```

### Installing a tool outside apt

Add the installation steps anywhere after the main `apt-get install` block. The Slurm, PMIx and Open MPI builds show the
pattern: download into the temporary `/slurm` directory, install under `/usr/local`, and let `trap 'rm -rf /slurm' EXIT`
remove the build tree. Keeping the image lean matters because it is distributed to students.

Unlike an apt package, a tool installed this way brings no licence notice, so copy its licence text to
`/usr/share/licenses/<tool>/` in the same step — see [Licensing](#licensing).

### Python packages

The build installs no packages with `pip`; `python3-mpi4py` and the rest come from apt. Prefer apt where a `python3-*`
package exists, so the licence notice lands in `/usr/share/doc` automatically. Otherwise add a call after the
`apt-get install` block:

```bash
pip3 install --break-system-packages --root-user-action=ignore your-package
```

If a package is only needed for one course and conflicts with others, consider installing it into a virtual environment
that the course exercises set up explicitly.

## Pre-installed software

The image ships with, among other things:

- Common CLI tools: bash, vim, nano, emacs (`emacs-nox`), tmux, screen, tree, git, curl, wget, less, rsync, unzip, file,
  htop, bc
- Compilers and build tools: gcc, g++ and make (via `build-essential`), perl
- Python 3 with pip, venv and mpi4py
- HPC stack: Slurm 24.05.8, Open MPI 4.1.4, PMIx 4.2.9, munge
- Man pages for all of the above, plus `manpages-posix`, `info` and `groff`

The `apt-get install` block in `configs/install_os_sw.sh` is the authoritative list.

## Licensing

CSC's own code is MIT-licensed, see [`LICENSE`](LICENSE). Everything else in the image is third-party and keeps its own
licence. The notices are inside the image, since whoever pulls it never sees this repository:

- `/usr/share/doc/<package>/copyright` — packages from the Ubuntu archive
- `/usr/share/licenses/` — Caddy, Slurm, PMIx and Open MPI
- `/app/js/vendor/`, `/app/css/vendor/`, `/app/fonts/` — the web assets

Nothing is patched, so the corresponding source is the upstream release, and `configs/install_os_sw.sh` pins every
version and download URL. To list the Ubuntu packages in a given image, run this inside the container and fetch the
source from <http://archive.ubuntu.com/ubuntu/>, or <http://old-releases.ubuntu.com/ubuntu/> for superseded versions:

```bash
dpkg-query -W -f='${Package}\t${Version}\t${source:Package}\n'
```

