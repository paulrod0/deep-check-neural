# ============================================================================
# Deep-Check NIST FRVT PAD — Build System
# ============================================================================
#
# Builds libfrvt_pad_deepcheck_001.so for NIST FATE PAD evaluation.
#
# Requirements:
#   - g++ with C++17 support
#   - ONNX Runtime C++ (see ONNXRT_DIR below)
#
# Usage:
#   make                  # Build shared library
#   make clean            # Remove build artifacts
#   make package          # Create submission package
#
# The resulting library + config/ dir form the complete NIST submission.
# ============================================================================

PROVIDER    := deepcheck
SEQUENCE    := 001
LIB_NAME    := libfrvt_pad_$(PROVIDER)_$(SEQUENCE).so

CXX         := g++
CXXFLAGS    := -std=c++17 -O2 -Wall -Wextra -fPIC
LDFLAGS     := -shared

# ONNX Runtime paths (adjust for your system)
ONNXRT_DIR  ?= /opt/onnxruntime
INCLUDES    := -Isrc/include -I$(ONNXRT_DIR)/include
LIBS        := -L$(ONNXRT_DIR)/lib -lonnxruntime -lpthread

SRC_DIR     := src/lib
BUILD_DIR   := build
CONFIG_DIR  := config

SOURCES     := $(SRC_DIR)/deep_check_pad.cpp
OBJECTS     := $(BUILD_DIR)/deep_check_pad.o

.PHONY: all clean package validate

all: $(BUILD_DIR)/$(LIB_NAME)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $< -o $@

$(BUILD_DIR)/$(LIB_NAME): $(OBJECTS)
	$(CXX) $(LDFLAGS) -o $@ $^ $(LIBS)
	@echo ""
	@echo "  Built: $(BUILD_DIR)/$(LIB_NAME)"
	@echo "  Size:  $$(du -h $@ | cut -f1)"
	@echo ""

clean:
	rm -rf $(BUILD_DIR)

# Create NIST submission package
package: $(BUILD_DIR)/$(LIB_NAME)
	@echo "Creating NIST submission package..."
	mkdir -p $(BUILD_DIR)/submission/lib
	mkdir -p $(BUILD_DIR)/submission/config
	cp $(BUILD_DIR)/$(LIB_NAME) $(BUILD_DIR)/submission/lib/
	cp $(CONFIG_DIR)/*.onnx $(BUILD_DIR)/submission/config/ 2>/dev/null || true
	cp $(CONFIG_DIR)/*.json $(BUILD_DIR)/submission/config/ 2>/dev/null || true
	@echo ""
	@echo "  Submission package: $(BUILD_DIR)/submission/"
	@echo "    lib/$(LIB_NAME)"
	@echo "    config/ (model files)"
	@echo ""
	@echo "  Next: run validation package, then encrypt and submit."
	@echo ""
