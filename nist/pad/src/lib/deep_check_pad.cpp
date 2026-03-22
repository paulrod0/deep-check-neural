/*
 * deep_check_pad.cpp — Deep-Check NIST FRVT PAD Implementation
 * ==============================================================
 *
 * Implements FRVT_PAD::Interface using:
 *   - EfficientNet-B4 + FrequencyBranchV2 deepfake detector (ONNX)
 *   - ONNX Runtime C++ API for CPU inference
 *
 * Model contract:
 *   Input:  "face_image" [batch, 3, 224, 224] float32, ImageNet-normalized
 *   Output: "logit" [batch] float32, sigmoid → P(attack)
 *
 * Score mapping:
 *   P(attack) → NIST score [-1, +1]:
 *     score = 2.0 * P(attack) - 1.0
 *     P=0.0 → score=-1.0 (certain bona fide)
 *     P=0.5 → score=0.0  (uncertain)
 *     P=1.0 → score=+1.0 (certain attack)
 *
 * Build:
 *   g++ -std=c++17 -O2 -shared -fPIC \
 *       -I../include -I/opt/onnxruntime/include \
 *       -o libfrvt_pad_deepcheck_001.so \
 *       deep_check_pad.cpp \
 *       -L/opt/onnxruntime/lib -lonnxruntime
 *
 * Provider:  deepcheck
 * Sequence:  001
 * Library:   libfrvt_pad_deepcheck_001.so
 */

#include "frvt_pad.h"
#include <onnxruntime_cxx_api.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <numeric>

namespace fs = std::filesystem;

// ── Constants ───────────────────────────────────────────────────────────────
static constexpr int IMG_SIZE = 224;
static constexpr int IMG_CHANNELS = 3;
static constexpr int IMG_PIXELS = IMG_SIZE * IMG_SIZE;

// ImageNet normalization
static constexpr float MEAN[3] = {0.485f, 0.456f, 0.406f};
static constexpr float STD[3]  = {0.229f, 0.224f, 0.225f};

// PAD threshold (calibrated at EER operating point)
static constexpr double PAD_THRESHOLD = 0.5;

// ── Implementation ──────────────────────────────────────────────────────────

class DeepCheckPAD : public FRVT_PAD::Interface {
public:
    DeepCheckPAD() = default;
    ~DeepCheckPAD() override = default;

    FRVT::ReturnStatus initialize(const std::string &configDir) override;

    FRVT::ReturnStatus detectImpersonationPA(
        const FRVT::Media &suspectedPA,
        bool &isPA,
        double &score,
        std::vector<std::pair<std::string, std::string>> &decisionProperties) override;

    FRVT::ReturnStatus detectEvasionPA(
        const FRVT::Media &suspectedPA,
        bool &isPA,
        double &score,
        std::vector<std::pair<std::string, std::string>> &decisionProperties) override;

private:
    std::unique_ptr<Ort::Session> session_;
    Ort::Env env_{ORT_LOGGING_LEVEL_WARNING, "DeepCheckPAD"};
    Ort::MemoryInfo mem_info_ = Ort::MemoryInfo::CreateCpu(
        OrtAllocatorType::OrtArenaAllocator, OrtMemType::OrtMemTypeDefault);

    // Core inference: returns P(attack) in [0, 1]
    double runInference(const FRVT::Image &image);

    // Bilinear resize + normalize → CHW float tensor
    void preprocessImage(const FRVT::Image &image, std::vector<float> &tensor);

    // Process media (still or video) and return aggregate score
    FRVT::ReturnStatus processMedia(
        const FRVT::Media &media,
        bool &isPA,
        double &score,
        std::vector<std::pair<std::string, std::string>> &props,
        const std::string &attackIntent);
};

// ── Factory ─────────────────────────────────────────────────────────────────

std::shared_ptr<FRVT_PAD::Interface>
FRVT_PAD::Interface::getImplementation() {
    return std::make_shared<DeepCheckPAD>();
}

// ── Initialize ──────────────────────────────────────────────────────────────

FRVT::ReturnStatus
DeepCheckPAD::initialize(const std::string &configDir) {
    // Find ONNX model in configDir
    std::string modelPath;
    for (const auto &entry : fs::directory_iterator(configDir)) {
        if (entry.path().extension() == ".onnx") {
            modelPath = entry.path().string();
            break;
        }
    }

    if (modelPath.empty()) {
        return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
            "No .onnx model found in configDir: " + configDir);
    }

    try {
        Ort::SessionOptions opts;
        opts.SetIntraOpNumThreads(1);  // NIST single-core requirement
        opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

        session_ = std::make_unique<Ort::Session>(
            env_, modelPath.c_str(), opts);

        std::cerr << "[DeepCheck] Loaded model: " << modelPath << std::endl;
        return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
    } catch (const Ort::Exception &e) {
        return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
            std::string("ONNX load failed: ") + e.what());
    }
}

// ── Image preprocessing ─────────────────────────────────────────────────────

void DeepCheckPAD::preprocessImage(
    const FRVT::Image &image, std::vector<float> &tensor)
{
    tensor.resize(IMG_CHANNELS * IMG_PIXELS);

    const uint8_t *src = image.data.get();
    const int srcW = image.width;
    const int srcH = image.height;
    const int srcC = image.depth / 8;  // 1 or 3

    // Bilinear interpolation resize to 224x224, then normalize to CHW
    for (int y = 0; y < IMG_SIZE; ++y) {
        float srcY = static_cast<float>(y) * (srcH - 1) / (IMG_SIZE - 1);
        int y0 = static_cast<int>(srcY);
        int y1 = std::min(y0 + 1, srcH - 1);
        float fy = srcY - y0;

        for (int x = 0; x < IMG_SIZE; ++x) {
            float srcX = static_cast<float>(x) * (srcW - 1) / (IMG_SIZE - 1);
            int x0 = static_cast<int>(srcX);
            int x1 = std::min(x0 + 1, srcW - 1);
            float fx = srcX - x0;

            for (int c = 0; c < 3; ++c) {
                float val;
                if (srcC == 3) {
                    // Bilinear interpolation
                    float v00 = src[(y0 * srcW + x0) * 3 + c];
                    float v01 = src[(y0 * srcW + x1) * 3 + c];
                    float v10 = src[(y1 * srcW + x0) * 3 + c];
                    float v11 = src[(y1 * srcW + x1) * 3 + c];
                    val = (1-fy) * ((1-fx)*v00 + fx*v01)
                        +    fy  * ((1-fx)*v10 + fx*v11);
                } else {
                    // Grayscale: replicate to all channels
                    float v00 = src[y0 * srcW + x0];
                    float v01 = src[y0 * srcW + x1];
                    float v10 = src[y1 * srcW + x0];
                    float v11 = src[y1 * srcW + x1];
                    val = (1-fy) * ((1-fx)*v00 + fx*v01)
                        +    fy  * ((1-fx)*v10 + fx*v11);
                }

                // Normalize: [0,255] → [0,1] → ImageNet
                float normalized = (val / 255.0f - MEAN[c]) / STD[c];
                // CHW layout: channel c, row y, col x
                tensor[c * IMG_PIXELS + y * IMG_SIZE + x] = normalized;
            }
        }
    }
}

// ── Inference ───────────────────────────────────────────────────────────────

double DeepCheckPAD::runInference(const FRVT::Image &image) {
    std::vector<float> inputTensor;
    preprocessImage(image, inputTensor);

    // Create ONNX input tensor [1, 3, 224, 224]
    std::array<int64_t, 4> inputShape = {1, IMG_CHANNELS, IMG_SIZE, IMG_SIZE};
    Ort::Value inputOrt = Ort::Value::CreateTensor<float>(
        mem_info_, inputTensor.data(), inputTensor.size(),
        inputShape.data(), inputShape.size());

    // Run inference
    const char *inputNames[] = {"face_image"};
    const char *outputNames[] = {"logit"};

    auto outputTensors = session_->Run(
        Ort::RunOptions{nullptr},
        inputNames, &inputOrt, 1,
        outputNames, 1);

    // Get logit → sigmoid → P(attack)
    float logit = outputTensors[0].GetTensorMutableData<float>()[0];
    double pAttack = 1.0 / (1.0 + std::exp(-static_cast<double>(logit)));

    return pAttack;
}

// ── Process media ───────────────────────────────────────────────────────────

FRVT::ReturnStatus DeepCheckPAD::processMedia(
    const FRVT::Media &media,
    bool &isPA,
    double &score,
    std::vector<std::pair<std::string, std::string>> &props,
    const std::string &attackIntent)
{
    if (media.images.empty()) {
        return FRVT::ReturnStatus(FRVT::ReturnCode::RefuseInput,
            "Empty media: no images provided");
    }

    if (!session_) {
        return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
            "Model not initialized");
    }

    try {
        double totalScore = 0.0;
        int validFrames = 0;

        for (const auto &image : media.images) {
            if (image.width < 10 || image.height < 10 || !image.data) {
                continue;
            }

            double pAttack = runInference(image);
            totalScore += pAttack;
            ++validFrames;
        }

        if (validFrames == 0) {
            score = 0.0;  // Uncertain
            isPA = false;
            props.push_back({"status", "no valid frames"});
            return FRVT::ReturnStatus(FRVT::ReturnCode::RefuseInput,
                "No valid images in media");
        }

        // Average P(attack) across all frames
        double avgPAttack = totalScore / validFrames;

        // Map P(attack) [0, 1] → NIST score [-1, +1]
        score = 2.0 * avgPAttack - 1.0;
        score = std::clamp(score, -1.0, 1.0);

        // Binary decision at threshold
        isPA = (avgPAttack >= PAD_THRESHOLD);

        // Decision properties
        if (isPA) {
            if (avgPAttack > 0.9) {
                props.push_back({"confidence", "high"});
            } else if (avgPAttack > 0.7) {
                props.push_back({"confidence", "medium"});
            } else {
                props.push_back({"confidence", "low"});
            }
            props.push_back({"attack_intent", attackIntent});
            props.push_back({"detection_method", "deep_learning_pixel_analysis"});
        } else {
            props.push_back({"classification", "bona_fide"});
        }

        if (media.type == FRVT::MediaType::Video) {
            props.push_back({"frames_analyzed", std::to_string(validFrames)});
        }

        return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
    } catch (const std::exception &e) {
        score = 0.0;
        isPA = false;
        return FRVT::ReturnStatus(FRVT::ReturnCode::VendorError,
            std::string("Inference error: ") + e.what());
    }
}

// ── PAD API functions ───────────────────────────────────────────────────────

FRVT::ReturnStatus
DeepCheckPAD::detectImpersonationPA(
    const FRVT::Media &suspectedPA,
    bool &isPA,
    double &score,
    std::vector<std::pair<std::string, std::string>> &decisionProperties)
{
    return processMedia(suspectedPA, isPA, score,
                        decisionProperties, "impersonation");
}

FRVT::ReturnStatus
DeepCheckPAD::detectEvasionPA(
    const FRVT::Media &suspectedPA,
    bool &isPA,
    double &score,
    std::vector<std::pair<std::string, std::string>> &decisionProperties)
{
    return processMedia(suspectedPA, isPA, score,
                        decisionProperties, "evasion");
}
