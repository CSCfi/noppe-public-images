#!/bin/bash

set -e

# always set this for scripts but don't declare as ENV..
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq \
  && apt-get install -y --no-install-recommends \
    gdal-bin \
    lbzip2 \
    build-essential \
    libglpk40 \
    libfftw3-dev \
    libgdal-dev \
    libgeos-dev \
    libgsl0-dev \
    libgl1-mesa-dev \
    libglu1-mesa-dev \
    libhdf4-alt-dev \
    libhdf5-dev \
    libjq-dev \
    libpq-dev \
    libproj-dev \
    libprotobuf-dev \
    libnetcdf-dev \
    libsqlite3-dev \
    libssl-dev \
    libudunits2-dev \
    lsb-release \
    netcdf-bin \
    postgis \
    protobuf-compiler \
    sqlite3 \
    tk-dev \
    unixodbc-dev \
    vim \
    nano \
    gawk \
    wget \
    git \
    whois \
    libmagick++-dev \
    gdebi-core

echo 'export PATH=/opt/conda/bin:$PATH' > /etc/profile.d/conda.sh
wget https://repo.anaconda.com/miniconda/Miniconda2-latest-Linux-x86_64.sh  -O ~/anaconda.sh
/bin/bash ~/anaconda.sh -b -p /opt/conda
rm ~/anaconda.sh
export PATH=$PATH:/opt/conda/bin
conda install -c conda-forge tbb

# lwgeom 0.2-2 and 0.2-3 have a regression which prevents install on ubuntu:bionic
## permissionless PAT for builds
UBUNTU_VERSION=${UBUNTU_VERSION:-`lsb_release -sc`}

if [ ${UBUNTU_VERSION} == "bionic" ]; then 
  R -e "Sys.setenv(GITHUB_PAT='0e7777db4b3bb48acb542b8912a989b8047f6351' \; remotes::install_github('r-spatial/lwgeom')"
fi


## Somehow foreign is messed up on CRAN between 2020-04-25 -- 2020-05-0?  
##install2.r --error --skipinstalled --repo https://mran.microsoft.com/snapshot/2020-04-24 foreign

install2.r --error --skipinstalled \
Rcpp  \
rmarkdown \
markdown \
cluster  \
factoextra  \
RColorBrewer  \
DT  \
plotly  \
rgl  \
forcats  \
purrr  \
readr  \
tidyr  \
tibble  \
tidyverse  \
zCompositions  \
truncnorm  \
NADA  \
survival  \
biclust  \
colorspace  \
grid  \
MASS  \
cobiclust  \
reticulate  \
reshape2  \
ape  \
pheatmap  \
ecodist  \
stringr  \
vegan  \
lattice  \
permute  \
ggsignif  \
patchwork  \
knitr  \
dplyr  \
ggraph  \
ggplot2  \
stats4  \
matrixStats  \
stats  \
graphics  \
grDevices  \
utils  \
datasets  \
methods  \
base  \
devtools  \
BiocManager \
openxlsx \
remotes 

R  -e "BiocManager::install(c('ggtree','MultiAssayExperiment', 'Biostrings', 'XVector', 'SingleCellExperiment', 'SummarizedExperiment', 'GenomicRanges', 'GenomeInfoDb', 'IRanges', 'S4Vectors', 'BiocGenerics','phyloseq','scran','tidySummarizedExperiment','DESeq2'))"


R -e "devtools::install_version('uwot', version = '0.1.10', repos = 'http://cran.us.r-project.org')"
R -e "install.packages('HGNChelper')"
R -e "BiocManager::install('org.Hs.eg.db', character.only = TRUE)"
R -e "BiocManager::install('scDblFinder')"
R -e "BiocManager::install('clusterProfiler')"
R -e "BiocManager::install('glmGamPoi')"
R -e "install.packages('Seurat')"

rm -r /tmp/downloaded_packages
