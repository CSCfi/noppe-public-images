# Use jupyter minimal notebook as base for your image
# It has conda already installed
FROM quay.io/jupyter/minimal-notebook:2025-02-03

# Set maintainer
LABEL org.opencontainers.image.authors="Kamyar Hasanzadeh <kamyar.hasanzadeh@helsinki.fi>, Noppe Team <noppe-admin@csc.fi>"

# Some first setup steps need to be run as root user
USER root

# Set home environment variable to point to user directory
ENV HOME /home/$NB_USER

# Install needed extra tools, e.g., ssh-client and less
RUN apt-get update \
 && apt-get install -y ssh-client less \
 && apt-get clean

# Switch back to non-root user
USER $NB_USER

# Install needed conda packages and jupyter lab extensions, then clean up conda to reduce image size
RUN conda install --yes -c conda-forge \
    python=3.12 \
    matplotlib \
    jupyterlab \
    jupyterlab-git \
    myst-nb \
    jupyterlab-myst \
    jupytext \
    fiona \
    rasterstats \
    xlrd \
    bokeh \
    contextily \
    folium \
    geojson \
    geopandas \
    geopy \
    mapclassify \
    osmnx \
    psycopg2 \
    pyproj \
    requests \
    plotly \
    scikit-learn \
    shapely \
    geoviews \
    networkx \
    sqlalchemy \
    stackstac \
    dask[distributed] \
    pystac-client \
    rioxarray \
    graphviz \
    python-graphviz \
 && conda clean -afy

# Build JupyterLab (optional)
# RUN jupyter lab build --dev-build=False --minimize=False

# disable announcement extension to get rid of newsletter subscription pop-up
RUN jupyter labextension disable "@jupyterlab/apputils-extension:announcements"

RUN git clone --branch develop https://github.com/Automating-GIS-processes/csc-intensive-course.git
