/*
 * NIST FRVT PAD API — Header file v1.5.2
 * Reconstructed from NIST specification document.
 * Namespace: FRVT_PAD
 *
 * Two detection functions:
 *   detectImpersonationPA — detect attacks trying to impersonate another identity
 *   detectEvasionPA — detect attacks trying to evade recognition
 *
 * Score convention:
 *   +1.0 = presentation attack detected (high confidence)
 *    0.0 = uncertain / no informative value
 *   -1.0 = bona fide (no attack, high confidence)
 */

#ifndef FRVT_PAD_H_
#define FRVT_PAD_H_

#include "frvt_structs.h"
#include <cstdint>
#include <string>
#include <vector>
#include <map>

namespace FRVT_PAD {

/** Optional key-value properties describing the PAD decision rationale. */
typedef std::map<std::string, std::string> DecisionProperties;

/**
 * @brief Abstract interface for PAD implementations.
 *
 * Developers implement this interface. NIST calls the factory function
 * getImplementation() to obtain a concrete instance.
 */
class Interface {
public:
    virtual ~Interface() {}

    /**
     * @brief Initialize the implementation.
     * Called once before any detect calls.
     *
     * @param[in] configDir
     * Path to read-only configuration directory containing model files.
     *
     * @return ReturnStatus
     */
    virtual FRVT::ReturnStatus
    initialize(const std::string &configDir) = 0;

    /**
     * @brief Detect impersonation presentation attacks.
     *
     * Score convention:
     *   +1.0 = attack detected
     *    0.0 = uncertain
     *   -1.0 = bona fide
     *
     * @param[in] media
     * Single image or video frames of one subject.
     *
     * @param[out] score
     * PAD score in [-1.0, +1.0].
     *
     * @param[out] decisionProperties
     * Optional metadata about the decision.
     *
     * @return ReturnStatus
     */
    virtual FRVT::ReturnStatus
    detectImpersonationPA(
        const FRVT::Media &media,
        double &score,
        DecisionProperties &decisionProperties) = 0;

    /**
     * @brief Detect evasion presentation attacks.
     *
     * @param[in] media
     * @param[out] score  PAD score in [-1.0, +1.0].
     * @param[out] decisionProperties
     * @return ReturnStatus
     */
    virtual FRVT::ReturnStatus
    detectEvasionPA(
        const FRVT::Media &media,
        double &score,
        DecisionProperties &decisionProperties) = 0;

    /**
     * @brief Factory method. NIST calls this to obtain an implementation.
     * @return Shared pointer to the concrete implementation.
     */
    static std::shared_ptr<Interface>
    getImplementation();
};

/*
 * Versioning — NIST externs these; participant compiles them.
 */
#ifdef NIST_EXTERN_PAD_VERSION
extern uint16_t FRVT_PAD_MAJOR_VERSION;
extern uint16_t FRVT_PAD_MINOR_VERSION;
#else
uint16_t FRVT_PAD_MAJOR_VERSION{1};
uint16_t FRVT_PAD_MINOR_VERSION{5};
#endif

} // namespace FRVT_PAD

#endif // FRVT_PAD_H_
