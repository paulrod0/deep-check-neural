# ============================================================================
# Deep-Check NIST FRVT PAD — Docker Build Environment
# ============================================================================
#
# Builds the PAD shared library inside a NIST-compatible environment.
# NIST uses CentOS/RHEL with specific library versions.
#
# Usage:
#   docker build -t deepcheck-pad-build .
#   docker run --rm -v $(pwd)/build:/output deepcheck-pad-build
#
# The library and config will be in ./build/submission/
# ============================================================================

FROM centos:7

# Install build tools
RUN yum -y install gcc-c++ make wget unzip && yum clean all

# Install ONNX Runtime 1.17 (CPU only, compatible with NIST infra)
ENV ONNXRT_VERSION=1.17.3
RUN cd /tmp && \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRT_VERSION}/onnxruntime-linux-x64-${ONNXRT_VERSION}.tgz && \
    tar xzf onnxruntime-linux-x64-${ONNXRT_VERSION}.tgz && \
    mv onnxruntime-linux-x64-${ONNXRT_VERSION} /opt/onnxruntime && \
    rm /tmp/onnxruntime-linux-x64-${ONNXRT_VERSION}.tgz && \
    echo "/opt/onnxruntime/lib" > /etc/ld.so.conf.d/onnxruntime.conf && \
    ldconfig

# Copy source
WORKDIR /build
COPY src/ src/
COPY Makefile .
COPY config/ config/

# Build
RUN make ONNXRT_DIR=/opt/onnxruntime

# Create submission package
RUN make package

# Output
CMD ["cp", "-r", "/build/build/submission/", "/output/"]
