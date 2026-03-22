/*
 * deep_check_pad.cpp — Deep-Check NIST FRVT PAD Implementation
 * ==============================================================
 * Loads EfficientNet-B4 + FrequencyBranchV2 ONNX model via ONNX Runtime
 * and implements the FRVT PAD interface for NIST evaluation.
 *
 * Library name: libfrvt_pad_deepcheck_000.so
 *
 * Build requirements:
 *   - ONNX Runtime C++ API (libonnxruntime.so)
 *   - Ubuntu 24.04, g++ with C++17
 *   - Intel Xeon Gold 6248 @ 2.50GHz (CPU only, no GPU)
 *
 * Model contract:
 *   Input:  "face_image" float32 [1, 3, 224, 224] (ImageNet normalized)
 *   Output: "logit"      float32 [1]              (sigmoid → P(fake))
 *
 * Score mapping:
 *   NIST wants [-1, +1] where +1 = attack
 *   Our model outputs P(fake) in [0, 1]
 *   Mapping: nist_score = 2 * P(fake) - 1
 *     P(fake)=0.0 → nist_score=-1.0 (bona fide)
 *     P(fake)=0.5 → nist_score= 0.0 (uncertain)
 *     P(fake)=1.0 → nist_score=+1.0 (attack)
 *
 * Time budget: 5000ms per 1280x960 image on Xeon Gold 6248 (1 core).
 * Our model runs in ~80ms on CPU → well within budget.
 */

#include "frvt_pad.h"

#include <onnxruntime_cxx_api.h>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <fstream>
#include <iostream>

namespace {

// Model configuration
constexpr int IMG_SIZE = 224;
constexpr int CHANNELS = 3;
constexpr float IMAGENET_MEAN[] = {0.485f, 0.456f, 0.406f};
constexpr float IMAGENET_STD[]  = {0.229f, 0.224f, 0.225f};

// Bilinear interpolation for resizing
void bilinear_resize(
    const uint8_t* src, int src_w, int src_h, int src_channels,
    float* dst, int dst_w, int dst_h)
{
    // dst is CHW format, ImageNet-normalized
    float x_ratio = static_cast<float>(src_w) / dst_w;
    float y_ratio = static_cast<float>(src_h) / dst_h;

    for (int y = 0; y < dst_h; y++) {
        float src_y = y * y_ratio;
        int y0 = std::min(static_cast<int>(src_y), src_h - 1);
        int y1 = std::min(y0 + 1, src_h - 1);
        float fy = src_y - y0;

        for (int x = 0; x < dst_w; x++) {
            float src_x = x * x_ratio;
            int x0 = std::min(static_cast<int>(src_x), src_w - 1);
            int x1 = std::min(x0 + 1, src_w - 1);
            float fx = src_x - x0;

            for (int c = 0; c < src_channels && c < CHANNELS; c++) {
                float v00 = src[(y0 * src_w + x0) * src_channels + c];
                float v01 = src[(y0 * src_w + x1) * src_channels + c];
                float v10 = src[(y1 * src_w + x0) * src_channels + c];
                float v11 = src[(y1 * src_w + x1) * src_channels + c];

                float val = v00 * (1-fx) * (1-fy) + v01 * fx * (1-fy)
                          + v10 * (1-fx) * fy     + v11 * fx * fy;

                // Normalize to [0,1] then ImageNet normalize, store as CHW
                float normalized = (val / 255.0f - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
                dst[c * dst_h * dst_w + y * dst_w + x] = normalized;
            }
        }
    }
}

} // anonymous namespace


class DeepCheckPAD : public FRVT_PAD::Interface {
public:
    DeepCheckPAD() : env_(ORT_LOGGING_LEVEL_WARNING, "DeepCheckPAD") {}

    ~DeepCheckPAD() override = default;

    FRVT::ReturnStatus
    initialize(const std::string &configDir) override
    {
        try {
            std::string model_path = configDir + "/deepfake_pixel_v3.onnx";

            // Verify model file exists
            std::ifstream f(model_path);
            if (!f.good()) {
                return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
                    "Model not found: " + model_path);
            }
            f.close();

            // Configure session options
            Ort::SessionOptions opts;
            opts.SetIntraOpNumThreads(1);  // NIST requires single-threaded
            opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
            opts.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);

            // Load model
            session_ = std::make_unique<Ort::Session>(env_, model_path.c_str(), opts);

            initialized_ = true;
            return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
        }
        catch (const Ort::Exception &e) {
            return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
                std::string("ONNX Runtime error: ") + e.what());
        }
        catch (const std::exception &e) {
            return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
                std::string("Init error: ") + e.what());
        }
    }

    FRVT::ReturnStatus
    detectImpersonationPA(
        const FRVT::Media &media,
        double &score,
        FRVT_PAD::DecisionProperties &props) override
    {
        return detectPA(media, score, props, "impersonation");
    }

    FRVT::ReturnStatus
    detectEvasionPA(
        const FRVT::Media &media,
        double &score,
        FRVT_PAD::DecisionProperties &props) override
    {
        return detectPA(media, score, props, "evasion");
    }

    static std::shared_ptr<FRVT_PAD::Interface>
    getImplementation()
    {
        return std::make_shared<DeepCheckPAD>();
    }

private:
    Ort::Env env_;
    std::unique_ptr<Ort::Session> session_;
    bool initialized_ = false;

    /**
     * Core PAD detection — shared between impersonation and evasion.
     *
     * For video input, we average scores across frames (temporal pooling).
     * This improves robustness against single-frame artifacts.
     */
    FRVT::ReturnStatus
    detectPA(
        const FRVT::Media &media,
        double &score,
        FRVT_PAD::DecisionProperties &props,
        const std::string &mode)
    {
        if (!initialized_) {
            return FRVT::ReturnStatus(FRVT::ReturnCode::UnknownError,
                "Not initialized");
        }

        if (media.data.empty()) {
            return FRVT::ReturnStatus(FRVT::ReturnCode::RefuseInput,
                "No image/video data provided");
        }

        try {
            std::vector<double> frame_scores;

            // Process each frame (for images, there's just one)
            int step = 1;
            if (media.type == FRVT::Media::Label::Video && media.data.size() > 10) {
                // Sample up to 10 frames from video for efficiency
                step = std::max(1, static_cast<int>(media.data.size()) / 10);
            }

            for (size_t i = 0; i < media.data.size(); i += step) {
                const auto &img = media.data[i];

                if (img.depth != 24 || img.width == 0 || img.height == 0) {
                    continue; // Skip non-RGB or empty frames
                }

                double frame_score = run_inference(img);
                frame_scores.push_back(frame_score);
            }

            if (frame_scores.empty()) {
                score = 0.0; // Uncertain
                return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
            }

            // Temporal aggregation: use mean for stability
            double sum = std::accumulate(frame_scores.begin(), frame_scores.end(), 0.0);
            double p_fake = sum / frame_scores.size();

            // Map P(fake) [0,1] → NIST score [-1, +1]
            score = 2.0 * p_fake - 1.0;
            score = std::max(-1.0, std::min(1.0, score));

            // Add decision properties
            props["algorithm"] = "DeepCheck-v3-EfficientNetB4-FreqV2";
            props["mode"] = mode;
            props["p_fake"] = std::to_string(p_fake);
            props["n_frames"] = std::to_string(frame_scores.size());

            return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
        }
        catch (const std::exception &e) {
            score = 0.0;
            return FRVT::ReturnStatus(FRVT::ReturnCode::ExtractError,
                std::string("Detection error: ") + e.what());
        }
    }

    /**
     * Run ONNX inference on a single FRVT::Image.
     * Returns P(fake) in [0, 1].
     */
    double run_inference(const FRVT::Image &img)
    {
        // Prepare input tensor: resize + normalize to [1, 3, 224, 224]
        std::vector<float> input_data(CHANNELS * IMG_SIZE * IMG_SIZE);

        bilinear_resize(
            img.data.get(), img.width, img.height, img.depth / 8,
            input_data.data(), IMG_SIZE, IMG_SIZE);

        // Create ONNX tensor
        std::array<int64_t, 4> input_shape = {1, CHANNELS, IMG_SIZE, IMG_SIZE};
        auto memory_info = Ort::MemoryInfo::CreateCpu(
            OrtArenaAllocator, OrtMemTypeDefault);

        Ort::Value input_tensor = Ort::Value::CreateTensor<float>(
            memory_info, input_data.data(), input_data.size(),
            input_shape.data(), input_shape.size());

        // Run inference
        const char* input_names[] = {"face_image"};
        const char* output_names[] = {"logit"};

        auto output_tensors = session_->Run(
            Ort::RunOptions{nullptr},
            input_names, &input_tensor, 1,
            output_names, 1);

        // Extract logit and apply sigmoid
        float logit = output_tensors[0].GetTensorMutableData<float>()[0];
        double p_fake = 1.0 / (1.0 + std::exp(-static_cast<double>(logit)));

        return p_fake;
    }
};

// Factory function implementation (required by NIST)
std::shared_ptr<FRVT_PAD::Interface>
FRVT_PAD::Interface::getImplementation()
{
    return DeepCheckPAD::getImplementation();
}
