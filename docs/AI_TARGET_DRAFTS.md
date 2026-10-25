# Client treatment goals and AI target drafts

Open a client's profile → Goals & Targets → Add from library to this treatment. The client is fixed to that profile, so reviewing/saving a template attaches it to that client's existing goal records. Templates remain editable and start Not Started. The standalone Goals screen remains available.

For a saved library goal, Suggest targets (AI) opens a draft review panel. Generate target drafts requests up to five suggestions. Edit & review target opens the usual target form: name, description, measurement, baseline, criteria and status are editable. Saving applies only that reviewed target; remaining suggestions are kept in the current screen for separate review. Unsaved drafts do not survive a full reload. There is no automatic target creation, activation or baseline assignment.

## Google Gemini free-tier setup

1. Open https://aistudio.google.com/api-keys and create an API key for a project on the **free tier without billing enabled**. Availability and quotas depend on Google's current account/region/model restrictions. Do not enable Cloud billing or upgrade for this app unless you deliberately approve paid usage.
2. In Vercel → aba-curser → Environment Variables → Production, add:

   | Key | Value | Type |
   | --- | --- | --- |
   | `LLM_PROVIDER` | `gemini` | Config |
   | `GEMINI_API_KEY` | The Google AI Studio API key | Secret / Sensitive |
   | `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Config |
   | `LLM_TARGETS_ENABLED` | `true` | Config |

3. Save and redeploy the current working production deployment.
4. Test a library goal with Suggest targets (AI). Review/edit each proposal before saving.

The key goes in **Value**; `GEMINI_API_KEY` is the literal variable name in **Key**. Do not send keys in chat or commit them. `LLM_API_KEY` is used only for OpenAI and is never sent to Google. No Gemini key means the selected Gemini feature stays disabled. There is no automatic fallback to OpenAI or another model when the free quota is exhausted. No SDK, paid queue, billing activation, search grounding or extra infrastructure is required.

Google's official pricing and model pages were checked on October 25, 2026: Gemini 3.5 Flash-Lite lists standard input/output as free of charge on the free tier; older 2.5 models restrict new-project access. This is a limited provider free tier, not an unlimited or permanent guarantee. The app cannot determine/enforce the Google project's billing plan from its API key: use an unbilled project to prevent paid usage. It makes no automatic retries and reports quota errors clearly.

Sources: [Pricing](https://ai.google.dev/gemini-api/docs/pricing?hl=en), [Models](https://ai.google.dev/gemini-api/docs/models?hl=en), [API keys](https://ai.google.dev/gemini-api/docs/api-key).

Google lists free-tier content as usable to improve its products. For that reason this feature sends only generic original library text. It never sends client information or individualized clinician edits. Do not extend it to send clinical records without a separate privacy review and appropriate provider agreement.

## Existing OpenAI option

To use an approved OpenAI API account instead, select `LLM_PROVIDER=openai` (also the backward-compatible default), set Sensitive `LLM_API_KEY`, optional `LLM_MODEL=gpt-4.1-mini`, and `LLM_TARGETS_ENABLED=true`. OpenAI API billing is separate from a ChatGPT subscription. Do not select this option without approving its usage costs. The October 25 hosted OpenAI check returned `credit_balance_exhausted`; that is an account balance issue, not successful generation.

## Privacy, permissions and failure handling

Only assigned BCBAs/authorized administrators can request suggestions or save targets; RBT/BT users are denied by the backend. The server resolves the original source ID to the uploaded generic library template. It sends only that original template's text/criteria/guidance and supported measurement types. It never sends client IDs/names, demographics, clinician edits, sessions, baselines or observations. Custom goals without a recognized library source are ineligible. Clinicians must review suitability for individualized goals.

Both adapters validate structured output against supported measurements, maximum lengths and a maximum five targets. Gemini safety-blocked, incomplete or malformed responses are rejected. Baselines are blank and statuses forced to Not Started. The app rate-limits generation to five requests per clinician per minute and uses a 25-second timeout without automatic retries. Quota, credential and network failures save nothing. Existing target permissions, clinical history and audit metadata apply on review/save. Prompts, generated text, provider error bodies and credentials are not logged.

## Validation limits

Service tests mock both providers to verify request shapes, key separation, disabled/unknown-provider behavior, minimized data, malformed/blocked/incomplete responses, quota/network/access failures, no retries/fallback, role restrictions, no automatic clinical writes, and edited target persistence. Browser checks cover the client-profile library and target review flow with the external AI response mocked. Actual Gemini account access and model output require a user-provided Google key and have not been verified without it.
