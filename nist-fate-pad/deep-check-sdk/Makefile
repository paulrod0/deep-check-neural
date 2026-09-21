# Deep-Check NIST FRVT PAD SDK — Build Configuration
# =====================================================
# Produces: libfrvt_pad_deepcheck_000.so
#
# Requirements:
#   - Ubuntu 24.04 (ubuntu-24.04.3-live-server-amd64.iso)
#   - ONNX Runtime 1.17+ C++ API (CPU provider)
#   - g++ with C++17 support
#   - No GPU dependencies
#
# Build:
#   make                  # Build shared library
#   make test             # Build + run validation
#   make clean            # Clean build artifacts
#   make package          # Create submission tarball

CXX       = g++
CXXFLAGS  = -std=c++17 -O2 -fPIC -Wall -Wextra
INCLUDES  = -Iinclude -I$(ORT_DIR)/include
LDFLAGS   = -L$(ORT_DIR)/lib -lonnxruntime -lpthread

# ONNX Runtime install directory
ORT_DIR ?= /usr/local

# Library naming per NIST convention
PROVIDER  = deepcheck
SEQUENCE  = 000
LIB_NAME  = libfrvt_pad_$(PROVIDER)_$(SEQUENCE).so

# Source files
SRC       = src/deep_check_pad.cpp
OBJ       = $(SRC:.cpp=.o)

# Config directory (contains ONNX model)
CONFIG_DIR = config

.PHONY: all clean test package

all: $(LIB_NAME)

$(LIB_NAME): $(SRC)
	$(CXX) $(CXXFLAGS) -shared $(INCLUDES) $(SRC) -o $@ $(LDFLAGS)
	@echo "Built: $(LIB_NAME)"
	@ls -lh $(LIB_NAME)

clean:
	rm -f $(LIB_NAME) *.o
	rm -f frvt_pad_deepcheck_000.tar.gz

test: $(LIB_NAME)
	@echo "=== Validation ==="
	@echo "Library: $(LIB_NAME)"
	@ldd $(LIB_NAME) | head -10
	@echo ""
	@echo "Model in config/:"
	@ls -lh $(CONFIG_DIR)/*.onnx 2>/dev/null || echo "  WARNING: No ONNX model in config/"
	@echo ""
	@echo "Ready for NIST validation package."

package: $(LIB_NAME)
	@echo "Creating submission package..."
	@mkdir -p submission/$(PROVIDER)_$(SEQUENCE)
	@cp $(LIB_NAME) submission/$(PROVIDER)_$(SEQUENCE)/
	@cp -r $(CONFIG_DIR) submission/$(PROVIDER)_$(SEQUENCE)/
	@cp -r lib/* submission/$(PROVIDER)_$(SEQUENCE)/ 2>/dev/null || true
	@tar czf frvt_pad_$(PROVIDER)_$(SEQUENCE).tar.gz -C submission $(PROVIDER)_$(SEQUENCE)
	@echo "Package: frvt_pad_$(PROVIDER)_$(SEQUENCE).tar.gz"
	@ls -lh frvt_pad_$(PROVIDER)_$(SEQUENCE).tar.gz
	@rm -rf submission
