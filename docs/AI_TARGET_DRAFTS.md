# Client treatment goals and AI target drafts

Open a client's profile → Goals & Targets → Add from library to this treatment. The client is fixed to that profile, so reviewing/saving a template attaches it to that client's existing goal records. Templates remain editable and start Not Started. The standalone Goals screen remains available.

For a saved library goal, Suggest targets (AI) opens a draft review panel. When configured, Generate target drafts requests up to five suggestions. Edit & review target opens the usual target form: name, description, measurement, baseline, criteria and status are editable. Saving applies only that reviewed target; remaining suggestions are kept in the current screen for separate review. Unsaved drafts are not clinical records and do not survive a full page reload. There is no automatic target creation, activation or baseline assignment.

## Provider setup (not activated by this change)

No LLM binding existed in the Vercel project during implementation. The OpenAI-compatible implementation is prepared but remains **off**. It does not use the assistant's platform credentials, and a ChatGPT subscription is not an API connection. No real provider call or billing activation was performed.

After an account/provider and usage costs are approved, set server-side Vercel production variables:
- `LLM_API_KEY`: the approved OpenAI API key, marked Sensitive; never `NEXT_PUBLIC_`.
- `LLM_MODEL`: approved compatible model ID; default `gpt-4.1-mini`.
- `LLM_TARGETS_ENABLED=true`: explicit opt-in; leave false/unset until ready.

Redeploy after changing variables. Configure provider usage budgets/limits before enabling. The app also limits generation to five requests per clinician per minute, applies a 25-second timeout, validates every draft and never automatically retries chargeable calls. Invalid/unavailable provider responses save nothing. Keep this disabled if a different provider is selected until its adapter/configuration is reviewed.

## Privacy and permissions

Only assigned BCBAs/authorized administrators can request suggestions or save target definitions; RBT/BT users are denied by the backend. The server resolves the goal's original source ID to the generic uploaded library template. It sends only that original template's text/criteria/guidance and supported measurement types. It never sends client IDs/names, demographics, clinician edits to the client goal, sessions, baseline values or observations. Custom goals without a recognized library source are ineligible. Suggestions therefore reflect the original template; clinicians must review suitability for any individualized goal edits.

Structured output is validated against supported measurements, maximum lengths and a maximum five targets. Baselines are blank and statuses forced to Not Started. AI text is draft material requiring clinical judgment, not evidence of measured performance. Existing backend permissions, clinical history and audit metadata apply to the reviewed target. Generated text/prompts and credentials are not logged.

## Validation limits

Tests use a mocked provider response to verify request minimization, malformed-response rejection, role restrictions, no automatic writes and edited target persistence. Browser checks cover actual client-profile selection/save and target review with only the external AI response mocked. No actual model quality, account authorization, model availability or billing behavior has been verified without a provider connection.
