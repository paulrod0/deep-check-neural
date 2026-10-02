# Why Evaluating AI Agents is Harder Than Building Them

*By Pablo Lopez Rodriguez*

---

Last year, I shipped an AI deepfake detection model with an AUC of 0.9999. The benchmark report was pristine: EER of 0.31%, tested across seven Kaggle datasets and 155,000 images. Anti-leak verified. Train-test overlap of exactly zero.

I was proud of it. Then I pointed it at real photos from real users, and it flagged 84.5% of them as fake.

That number still sits with me. Not because the model was bad -- it was genuinely excellent at the task it had been evaluated on. The problem was that the evaluation itself was the wrong test. And I think this is one of the most underappreciated risks in enterprise AI today.

## The AUC Illusion

If you work in machine learning, you have probably seen a dashboard where every metric is green. AUC above 0.99. Precision and recall balanced. Calibration curves hugging the diagonal. It feels like the model is ready for production.

But AUC measures how well your model separates classes *within the distribution it was tested on*. It says nothing about what happens when the input distribution shifts -- and in production, it always shifts.

In our case, the model had learned to distinguish real faces from synthetic ones across curated research datasets. The images were clean, well-lit, consistently sized. When we deployed it against photos taken on phone cameras, compressed through WhatsApp, or scraped from dating profiles with JPEG artifacts, the model's internal representations broke down. It had never seen that kind of noise during training or evaluation, so it treated the artifacts as evidence of manipulation.

AUC 0.9999 meant nothing to the user who uploaded a selfie and was told it was a deepfake.

## In-Distribution Testing Is Not Validation

This is the pattern I see repeated across the industry: teams train a model on Dataset A, hold out 20% of Dataset A for testing, hit strong numbers, and ship. The evaluation is technically correct -- the hold-out was never seen during training. But it came from the same source, the same camera pipeline, the same demographic distribution, and the same post-processing.

This is in-distribution testing. It tells you your model learned the patterns in that dataset. It does not tell you the model will generalize.

True validation requires cross-source evaluation. You train on sources A, B, and C, then test on source D -- one the model has never seen, from a different camera, a different generator, a different population. When we started doing this at Deep-Check, our metrics dropped. Not because the model got worse, but because we finally started measuring the right thing.

## The Domain Gap Is Wider Than You Think

The gap between research benchmarks and production data is not a small delta you can patch with augmentation. It is structural.

Research datasets are curated. They have consistent resolution, controlled lighting, and balanced classes. Production data is messy. Users upload blurry photos, screenshots of screenshots, images cropped by social media platforms, photos taken in low light with cheap sensors. Each of these introduces artifacts that a model trained on clean data interprets as anomalies.

We call this the domain gap, and closing it required us to fundamentally rethink our training pipeline. We went from 155K images across 7 sources to 1.17 million images across 13 sources -- StyleGAN2, ProGAN, CycleGAN, StarGAN, Stable Diffusion, the DFDC dataset, anti-spoofing data, and more. We added aggressive augmentation: JPEG compression at quality 10, Gaussian blur, grayscale conversion, random resizing. We wanted the model to see every kind of degradation it would encounter in production before it ever reached a user.

The results tell the story. After retraining with cross-source data and robustness testing, we maintained AUC above 0.999 on clean images while keeping AUC at 0.9986 even under extreme JPEG compression and 0.9801 under grayscale conversion. The model got slightly worse on pristine benchmarks and dramatically better at the thing that actually matters: working on real data from real users.

## What I Would Tell My Past Self

If I could go back, here is what I would change from day one:

**Never evaluate only on your training distribution.** Hold out entire data sources, not just data points. If every test image comes from the same pipeline as your training images, you are measuring memorization, not generalization.

**Build robustness testing into your evaluation suite.** We now test every model against JPEG compression, blur, grayscale, and downscaling as standard. If a model cannot handle Q10 JPEG, it cannot handle WhatsApp.

**Invest in foundation models.** We are moving toward architectures like DINOv2 and DINOv3 that learn robust visual features through self-supervised pretraining on diverse data. They close the domain gap before task-specific fine-tuning even begins.

**Track production-facing metrics, not just offline metrics.** The false positive rate on real user photos is a more important number than AUC on your test set. Measure what your users experience, not what your validation loop reports.

## Why This Matters Beyond Deepfake Detection

This is not a niche problem. Every enterprise deploying AI faces some version of it. Document verification models trained on scanned PDFs fail on phone photos of crumpled papers. Fraud detection models trained on historical patterns miss novel attack vectors. Chatbot evaluations based on curated test prompts say nothing about how users actually talk.

If your evaluation does not catch these failures, your users will. And in regulated industries -- finance, healthcare, identity -- that gap between benchmark performance and real-world performance is not just an engineering problem. It is a compliance risk.

Building the model is the easy part. Building an evaluation that actually tells you whether the model works -- that is the real engineering challenge.

---

*Pablo Lopez Rodriguez is a machine learning engineer at CaixaBank and the creator of Deep-Check, an AI-powered identity verification platform. He works on deepfake detection, biometric verification, and applied ML systems.*

#ArtificialIntelligence #MachineLearning #MLOps #DeepLearning #AIEvaluation #DeepfakeDetection #ComputerVision #EnterpriseAI #ModelValidation #DataScience #AIEthics #ResponsibleAI
