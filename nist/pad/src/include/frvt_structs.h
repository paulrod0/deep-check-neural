/*
 * frvt_structs.h — NIST FRVT Common Data Structures (v3.1)
 *
 * Subset of the official NIST FRVT common structures needed for PAD.
 * Full version: https://github.com/usnistgov/frvt/blob/master/common/src/include/frvt_structs.h
 */

#ifndef FRVT_STRUCTS_H_
#define FRVT_STRUCTS_H_

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace FRVT {

/** Image label/type */
enum class ImageLabel {
    Unknown = 0,
    FaceISO = 1,
    FaceMugshot = 2,
    FacePhotoJournalism = 3,
    FaceWild = 4,
};

/** Light source */
enum class LightSource {
    Visible = 0,
    NIR = 1,
};

/** A single biometric image */
struct Image {
    /** Width in pixels */
    uint16_t width;
    /** Height in pixels */
    uint16_t height;
    /** Bits per pixel (8 = grayscale, 24 = RGB) */
    uint8_t depth;
    /** Raw pixel data (row-major, RGB interleaved if depth=24) */
    std::shared_ptr<uint8_t> data;
    /** Image type classification */
    ImageLabel label;
    /** Light source */
    LightSource lightSource;

    Image() :
        width{0}, height{0}, depth{24},
        data{nullptr},
        label{ImageLabel::Unknown},
        lightSource{LightSource::Visible}
    {}

    Image(uint16_t w, uint16_t h, uint8_t d, std::shared_ptr<uint8_t> dat) :
        width{w}, height{h}, depth{d}, data{dat},
        label{ImageLabel::Unknown},
        lightSource{LightSource::Visible}
    {}

    /** Total bytes = width * height * (depth / 8) */
    size_t size() const { return static_cast<size_t>(width) * height * (depth / 8); }
};

/** Media type */
enum class MediaType {
    StillImage = 0,
    Video = 1,
};

/** Container for image or video frames */
struct Media {
    /** Still image or video */
    MediaType type;
    /** Image(s): single for still, multiple for video frames */
    std::vector<Image> images;
    /** Frame rate (fps) for video; 0 for still images */
    double fps;

    Media() : type{MediaType::StillImage}, fps{0.0} {}
};

/** Return codes */
enum class ReturnCode {
    Success = 0,
    ConfigError = 1,
    RefuseInput = 2,
    ExtractError = 3,
    ParseError = 4,
    TemplateCreationError = 5,
    VerifTemplateError = 6,
    FaceDetectionError = 7,
    NumDataError = 8,
    TemplateFormatError = 9,
    EnrollDirError = 10,
    InputLocationError = 11,
    MemoryError = 12,
    NotImplemented = 13,
    VendorError = 14,
};

/** Return status with optional info string */
struct ReturnStatus {
    ReturnCode code;
    std::string info;

    ReturnStatus() : code{ReturnCode::Success} {}
    explicit ReturnStatus(ReturnCode c, const std::string &i = "")
        : code{c}, info{i} {}
};

} // namespace FRVT

#endif // FRVT_STRUCTS_H_
