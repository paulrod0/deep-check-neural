/*
 * frvt_pad.h — NIST FRVT PAD Interface (v1.5.2)
 *
 * Deep-Check implementation of the NIST FATE Presentation Attack Detection API.
 * Implements both detectImpersonationPA and detectEvasionPA.
 *
 * See: https://pages.nist.gov/frvt/api/FRVT_pad_api.pdf
 */

#ifndef FRVT_PAD_H_
#define FRVT_PAD_H_

#include "frvt_structs.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace FRVT_PAD {

/**
 * @brief PAD Interface — all implementations must subclass this.
 *
 * The NIST test harness calls getImplementation() to get a shared_ptr,
 * then calls initialize(), then forks N processes that each call
 * detectImpersonationPA() and/or detectEvasionPA().
 */
class Interface {
public:
    virtual ~Interface() {}

    /**
     * @brief Factory method returning the implementation instance.
     * @details Must be implemented by the submitted library.
     */
    static std::shared_ptr<Interface> getImplementation();

    /**
     * @brief Initialize the PAD implementation.
     * @details Called ONCE before any fork() or PAD calls.
     *
     * @param[in] configDir Read-only directory with model files and config.
     * @return ReturnStatus indicating success or failure.
     */
    virtual FRVT::ReturnStatus initialize(
        const std::string &configDir) = 0;

    /**
     * @brief Detect impersonation presentation attack.
     * @details Determines if input media contains a PA intended to
     *          impersonate/spoof a target identity (e.g., printed photo,
     *          replay video, silicone mask, deepfake).
     *
     * @param[in]  suspectedPA         Input media (still image or video frames)
     * @param[out] isPA                True if PA detected, False otherwise
     * @param[out] score               Confidence score in [-1, +1]:
     *                                   -1 = certainly bona fide
     *                                    0 = uncertain
     *                                   +1 = certainly PA
     * @param[out] decisionProperties  Optional key-value pairs describing the
     *                                 PA type (e.g., "replay attack", "deepfake")
     * @return ReturnStatus
     */
    virtual FRVT::ReturnStatus detectImpersonationPA(
        const FRVT::Media &suspectedPA,
        bool &isPA,
        double &score,
        std::vector<std::pair<std::string, std::string>> &decisionProperties) = 0;

    /**
     * @brief Detect evasion presentation attack.
     * @details Determines if input media contains a PA intended to conceal
     *          the subject's true identity (e.g., large pose, occlusion,
     *          exaggerated expression).
     *
     * @param[in]  suspectedPA         Input media (still image or video frames)
     * @param[out] isPA                True if PA detected, False otherwise
     * @param[out] score               Confidence score in [-1, +1]
     * @param[out] decisionProperties  Optional key-value pairs
     * @return ReturnStatus
     */
    virtual FRVT::ReturnStatus detectEvasionPA(
        const FRVT::Media &suspectedPA,
        bool &isPA,
        double &score,
        std::vector<std::pair<std::string, std::string>> &decisionProperties) = 0;
};

} // namespace FRVT_PAD

#endif // FRVT_PAD_H_
