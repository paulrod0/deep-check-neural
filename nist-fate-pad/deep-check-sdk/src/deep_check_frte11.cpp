/*
 * deep_check_frte11.cpp — Deep-Check NIST FRTE 1:1 Implementation
 * =================================================================
 * Face verification (1:1) using face embedding model + cosine similarity.
 *
 * Library name: libfrvt11_deepcheck_000.so
 *
 * Architecture:
 *   1. Face detection: Simple center-crop (NIST images are pre-aligned)
 *   2. Face embedding: MobileFaceNet ONNX (512-dim embedding)
 *   3. Matching: Cosine similarity between enrollment and verification embeddings
 *
 * The template is the raw 512-dimensional float32 embedding (2048 bytes).
 * Eye coordinates are estimated from the face region center.
 *
 * Build: Ubuntu 24.04, g++ C++17, ONNX Runtime CPU, no GPU.
 * Time budget: NIST FRTE allows generous time limits per image.
 */

#include "frvt11.h"
#include "frvt_structs.h"

#include <onnxruntime_cxx_api.h>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <fstream>
#include <cstring>

namespace {

constexpr int FACE_SIZE = 112;  // MobileFaceNet input size
constexpr int EMBED_DIM = 512;  // Embedding dimension
constexpr float IMAGENET_MEAN[] = {0.5f, 0.5f, 0.5f};
constexpr float IMAGENET_STD[]  = {0.5f, 0.5f, 0.5f};

// Bilinear resize + normalize to CHW float32
void preprocess_face(
    const uint8_t* src, int src_w, int src_h, int channels,
    float* dst, int dst_size)
{
    float x_ratio = static_cast<float>(src_w) / dst_size;
    float y_ratio = static_cast<float>(src_h) / dst_size;

    for (int y = 0; y < dst_size; y++) {
        float sy = y * y_ratio;
        int y0 = std::min(static_cast<int>(sy), src_h - 1);
        int y1 = std::min(y0 + 1, src_h - 1);
        float fy = sy - y0;

        for (int x = 0; x < dst_size; x++) {
            float sx = x * x_ratio;
            int x0 = std::min(static_cast<int>(sx), src_w - 1);
            int x1 = std::min(x0 + 1, src_w - 1);
            float fx = sx - x0;

            for (int c = 0; c < channels && c < 3; c++) {
                float v00 = src[(y0 * src_w + x0) * channels + c];
                float v01 = src[(y0 * src_w + x1) * channels + c];
                float v10 = src[(y1 * src_w + x0) * channels + c];
                float v11 = src[(y1 * src_w + x1) * channels + c];
                float val = v00*(1-fx)*(1-fy) + v01*fx*(1-fy)
                          + v10*(1-fx)*fy     + v11*fx*fy;
                float norm = (val / 255.0f - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
                dst[c * dst_size * dst_size + y * dst_size + x] = norm;
            }
        }
    }
}

// L2 normalize a vector in-place
void l2_normalize(float* vec, int dim) {
    float norm = 0.0f;
    for (int i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = std::sqrt(norm + 1e-10f);
    for (int i = 0; i < dim; i++) vec[i] /= norm;
}

// Cosine similarity between two L2-normalized vectors
double cosine_similarity(const float* a, const float* b, int dim) {
    double dot = 0.0;
    for (int i = 0; i < dim; i++) dot += a[i] * b[i];
    return dot;
}

} // anonymous namespace


class DeepCheckFRTE11 : public FRVT_11::Interface {
public:
    DeepCheckFRTE11() : env_(ORT_LOGGING_LEVEL_WARNING, "DeepCheckFRTE11") {}
    ~DeepCheckFRTE11() override = default;

    FRVT::ReturnStatus
    initialize(const std::string &configDir) override
    {
        try {
            std::string model_path = configDir + "/face_embed.onnx";
            std::ifstream f(model_path);
            if (!f.good()) {
                return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
                    "Face embedding model not found: " + model_path);
            }
            f.close();

            Ort::SessionOptions opts;
            opts.SetIntraOpNumThreads(1);
            opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
            opts.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);

            session_ = std::make_unique<Ort::Session>(env_, model_path.c_str(), opts);
            initialized_ = true;
            return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
        }
        catch (const std::exception &e) {
            return FRVT::ReturnStatus(FRVT::ReturnCode::ConfigError,
                std::string("Init error: ") + e.what());
        }
    }

    /**
     * Create face template from one or more images of one person.
     * Template = L2-normalized 512-dim float32 embedding (2048 bytes).
     * If multiple images, average the embeddings then re-normalize.
     */
    FRVT::ReturnStatus
    createFaceTemplate(
        const std::vector<FRVT::Image> &faces,
        FRVT::TemplateRole role,
        std::vector<uint8_t> &templ,
        std::vector<FRVT::EyePair> &eyeCoordinates) override
    {
        (void)role;

        if (!initialized_ || faces.empty()) {
            // Return a "failed" template (all zeros) that matchTemplates can handle
            templ.resize(EMBED_DIM * sizeof(float), 0);
            eyeCoordinates.resize(faces.size());
            return FRVT::ReturnStatus(
                faces.empty() ? FRVT::ReturnCode::RefuseInput : FRVT::ReturnCode::UnknownError);
        }

        try {
            std::vector<float> avg_embedding(EMBED_DIM, 0.0f);
            int valid_count = 0;

            for (size_t i = 0; i < faces.size(); i++) {
                const auto &img = faces[i];

                // Eye coordinate estimation (center of image)
                FRVT::EyePair eyes;
                if (img.width > 0 && img.height > 0 && img.depth == 24) {
                    eyes.isLeftAssigned = true;
                    eyes.isRightAssigned = true;
                    eyes.xleft = static_cast<uint16_t>(img.width * 0.35);
                    eyes.yleft = static_cast<uint16_t>(img.height * 0.38);
                    eyes.xright = static_cast<uint16_t>(img.width * 0.65);
                    eyes.yright = static_cast<uint16_t>(img.height * 0.38);
                }
                eyeCoordinates.push_back(eyes);

                if (img.depth != 24 || img.width < 20 || img.height < 20) continue;

                // Extract embedding
                std::vector<float> embedding(EMBED_DIM);
                if (extract_embedding(img, embedding.data())) {
                    for (int j = 0; j < EMBED_DIM; j++)
                        avg_embedding[j] += embedding[j];
                    valid_count++;
                }
            }

            if (valid_count > 0) {
                // Average and normalize
                for (int j = 0; j < EMBED_DIM; j++)
                    avg_embedding[j] /= valid_count;
                l2_normalize(avg_embedding.data(), EMBED_DIM);
            }

            // Serialize embedding to template bytes
            templ.resize(EMBED_DIM * sizeof(float));
            std::memcpy(templ.data(), avg_embedding.data(), templ.size());

            return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
        }
        catch (const std::exception &e) {
            templ.resize(EMBED_DIM * sizeof(float), 0);
            return FRVT::ReturnStatus(FRVT::ReturnCode::ExtractError,
                std::string("Template error: ") + e.what());
        }
    }

    /**
     * Iris template creation — not implemented (face-only system).
     */
    FRVT::ReturnStatus
    createIrisTemplate(
        const std::vector<FRVT::Image> &irises,
        FRVT::TemplateRole role,
        std::vector<uint8_t> &templ,
        std::vector<FRVT::IrisAnnulus> &irisLocations) override
    {
        (void)irises; (void)role;
        templ.resize(EMBED_DIM * sizeof(float), 0);
        irisLocations.resize(irises.size());
        return FRVT::ReturnStatus(FRVT::ReturnCode::NotImplemented);
    }

    /**
     * Multi-face detection from single image.
     * For simplicity, detect one face (center crop).
     */
    FRVT::ReturnStatus
    createFaceTemplate(
        const FRVT::Image &image,
        FRVT::TemplateRole role,
        std::vector<std::vector<uint8_t>> &templs,
        std::vector<FRVT::EyePair> &eyeCoordinates) override
    {
        std::vector<FRVT::Image> faces = {image};
        std::vector<uint8_t> templ;
        FRVT::EyePair eyes;
        std::vector<FRVT::EyePair> eyesVec;

        auto status = createFaceTemplate(faces, role, templ, eyesVec);
        templs.push_back(templ);
        if (!eyesVec.empty()) eyeCoordinates.push_back(eyesVec[0]);
        else eyeCoordinates.push_back(FRVT::EyePair());

        return status;
    }

    /**
     * Match two templates by cosine similarity.
     * Templates are L2-normalized 512-dim embeddings.
     */
    FRVT::ReturnStatus
    matchTemplates(
        const std::vector<uint8_t> &verifTemplate,
        const std::vector<uint8_t> &enrollTemplate,
        double &score) override
    {
        const size_t expected = EMBED_DIM * sizeof(float);

        if (verifTemplate.size() != expected || enrollTemplate.size() != expected) {
            score = -1.0;
            return FRVT::ReturnStatus(FRVT::ReturnCode::VerifTemplateError);
        }

        // Check for failed templates (all zeros)
        bool verif_zero = true, enroll_zero = true;
        for (size_t i = 0; i < expected && (verif_zero || enroll_zero); i++) {
            if (verifTemplate[i] != 0) verif_zero = false;
            if (enrollTemplate[i] != 0) enroll_zero = false;
        }
        if (verif_zero || enroll_zero) {
            score = -1.0;
            return FRVT::ReturnStatus(FRVT::ReturnCode::VerifTemplateError);
        }

        const float* v = reinterpret_cast<const float*>(verifTemplate.data());
        const float* e = reinterpret_cast<const float*>(enrollTemplate.data());

        // Cosine similarity (already L2-normalized)
        double sim = cosine_similarity(v, e, EMBED_DIM);

        // Map from [-1, 1] to [0, max] where higher = more similar
        // NIST expects higher score = more similar for face
        score = std::max(0.0, (sim + 1.0) / 2.0 * 100.0);

        return FRVT::ReturnStatus(FRVT::ReturnCode::Success);
    }

    static std::shared_ptr<FRVT_11::Interface>
    getImplementation()
    {
        return std::make_shared<DeepCheckFRTE11>();
    }

private:
    Ort::Env env_;
    std::unique_ptr<Ort::Session> session_;
    bool initialized_ = false;

    /**
     * Extract 512-dim face embedding from an FRVT::Image.
     * Returns true on success.
     */
    bool extract_embedding(const FRVT::Image &img, float* embedding)
    {
        // Preprocess: resize to 112x112, normalize
        std::vector<float> input_data(3 * FACE_SIZE * FACE_SIZE);
        preprocess_face(
            img.data.get(), img.width, img.height, img.depth / 8,
            input_data.data(), FACE_SIZE);

        // ONNX inference
        std::array<int64_t, 4> shape = {1, 3, FACE_SIZE, FACE_SIZE};
        auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        Ort::Value tensor = Ort::Value::CreateTensor<float>(
            mem, input_data.data(), input_data.size(), shape.data(), shape.size());

        // Get input/output names dynamically
        auto input_name = session_->GetInputNameAllocated(0, Ort::AllocatorWithDefaultOptions());
        auto output_name = session_->GetOutputNameAllocated(0, Ort::AllocatorWithDefaultOptions());
        const char* in_names[] = {input_name.get()};
        const char* out_names[] = {output_name.get()};

        auto output = session_->Run(
            Ort::RunOptions{nullptr}, in_names, &tensor, 1, out_names, 1);

        const float* raw = output[0].GetTensorData<float>();
        auto out_shape = output[0].GetTensorTypeAndShapeInfo().GetShape();
        int dim = static_cast<int>(out_shape.back());

        // Copy and L2-normalize
        int copy_dim = std::min(dim, EMBED_DIM);
        std::memcpy(embedding, raw, copy_dim * sizeof(float));
        if (copy_dim < EMBED_DIM)
            std::memset(embedding + copy_dim, 0, (EMBED_DIM - copy_dim) * sizeof(float));
        l2_normalize(embedding, EMBED_DIM);

        return true;
    }
};

// Factory
std::shared_ptr<FRVT_11::Interface>
FRVT_11::Interface::getImplementation()
{
    return DeepCheckFRTE11::getImplementation();
}
