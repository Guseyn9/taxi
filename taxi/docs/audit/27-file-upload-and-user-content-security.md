# Stage 27 — File upload, image/document handling and user content

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: file picker constraints, MIME checks, file size/count controls, Base64 conversion, upload metadata, profile/avatar uploads, retrieval and preview lifecycle, JSON import and ZIP handling.
- This is a frontend source review. Backend upload validation, storage ACLs, malware scanning and content delivery headers were not inspected.
- No application source changed.

## Executive result

The frontend supports driver document/photo upload, profile image upload, avatar update and JSON configuration import. The reviewed code does not establish a complete upload security boundary:
- registration checks only the first selected file's browser-reported MIME type;
- no frontend file-size or aggregate upload-size limit was found;
- avatar upload has no visible `accept` restriction or client-side image validation;
- uploaded files are sent as Base64 JSON with `private: 0`;
- the API upload wrapper does not validate the server response status before returning a value;
- a profile upload path silently omits a file ID when the response does not contain `dl_id`;
- downloaded image object URLs are not revoked in the reviewed profile/form flows;
- Sandbox imports JSON by parsing the entire file without a size/schema/depth guard.

No ZIP archive import/extraction implementation or ZIP library was found in the reviewed frontend source. This does not assess server-side archive handling or dependencies outside the searched source paths.

## 1. Registration document validation

### FILE-27-01 — Only the first file MIME type is checked

<badge>High if backend trusts client validation</badge>

**Observed:** `getYupImageSchema` in `LoginModal/Register.tsx` checks `value[0].type` and accepts `image/jpeg` or `image/png`. The registration inputs allow `multiple: true`. The file input's `accept` attribute is `image/png, image/jpeg, image/jpg`.

**Impact:** for a multi-file selection, files after index zero are not checked by this schema. Browser MIME type and `accept` are user-controlled hints, not proof of file format. A renamed executable, HTML/SVG payload or malformed image can report an allowed MIME type or bypass a UI hint.

**Recommendation:**
- Validate every selected file, not only the first.
- Treat client checks as usability only; backend must inspect file signatures/magic bytes and decode/re-encode images using a safe image library.
- For document photos, allow only required raster formats (e.g. JPEG/PNG), reject SVG/HTML and polyglot/invalid files.
- Enforce server-side count, per-file size and total request size limits.
- Add tests with a valid first file followed by a disallowed second file, spoofed MIME, extension mismatch and malformed image.

**Unverified:** whether the backend already performs robust file-content validation.

## 2. File size and upload volume

### FILE-27-02 — No explicit frontend file-size or count limit found

<badge>Medium; server enforcement required</badge>

**Observed:** searched upload components and registration/profile paths for file size checks, maximum file count and total-size guards. The reviewed paths append selected files and convert each to a Base64 data URL without an explicit size check. Registration accepts multiple files.

**Impact:** oversized images or large batches can consume browser memory during Base64 conversion, increase request payload size and cause slow uploads, failed registration/profile updates or resource exhaustion. Base64 also expands the binary payload by roughly one third before multipart/form-data overhead.

**Recommendation:**
- Define product limits for per-file bytes, number of files per field and aggregate bytes.
- Enforce them both in the picker/submit UI and at the API gateway/backend.
- Resize/re-encode images on a controlled path where appropriate; do not treat client-side resizing as the security control.
- Upload files individually or in bounded batches and provide progress/error/retry behavior.
- Reject requests early at the server before decoding large Base64 bodies.

**Unverified:** actual limits in reverse proxy, PHP runtime, API backend or object storage.

## 3. Base64 upload contract and public visibility

### FILE-27-03 — Upload sends file payload with `private: 0`

<badge>High pending storage ACL verification</badge>

**Observed:** `API.uploadFile` converts the selected File via `getBase64`, then sends JSON containing `base64` and `u_id`, along with `private: 0`, to `POST /dropbox/file`. The method is explicitly configured with `authRequired: false` in the generic wrapper, while manually including token and u_hash supplied by callers.

**Impact:** `private: 0` may indicate public storage or public file classification. Driver passport/license photos are sensitive identity documents. If the backend interprets this flag as public visibility, document IDs or predictable download URLs could expose highly sensitive images. The frontend alone cannot establish the meaning of this field.

**Recommendation:**
1. Confirm the exact backend semantics of `private: 0`; do not assume it means private.
2. Identity documents and profile records must use private storage, authenticated owner-scoped retrieval and short-lived signed download URLs where needed.
3. Ensure file retrieval checks both user identity and authorization for the parent record; an integer file ID must not be a bearer capability.
4. Keep public avatars separate from identity documents with explicit visibility policy.
5. If documents have already been stored publicly, audit access logs and exposure, migrate to private storage and invalidate old public links.

**Unverified:** backend meaning of the flag, object ACLs, URL entropy, download authorization, retention/deletion policy and existing file exposure.

### FILE-27-04 — Upload response is not normalized/validated in API wrapper

**Severity: Medium**

**Observed:** `_uploadFile` posts to `/dropbox/file` and returns `{ ...res, dl_id: res?.data?.data?.dl_id }`. It does not explicitly reject a body with business-level `status: error`, nor does it require a non-empty `dl_id`.

Two call paths behave differently:
- registration helper checks `resData.status === 'success'` before collecting a file ID, but may continue profile registration/update with missing IDs;
- profile modal adds an ID only if `res?.dl_id` is truthy, otherwise silently proceeds with an incomplete image map.

**Impact:** registration/profile data can be saved without all required files while UI flows may report success or leave the user unable to understand which upload failed.

**Recommendation:** normalize upload response centrally; require explicit success and a valid file ID; reject malformed/HTTP-200 business errors. Do not commit document metadata until every required upload succeeds. Provide per-file failure feedback and retry without duplicate file records.

## 4. Avatar upload

### FILE-27-05 — Avatar accepts arbitrary selected file at UI boundary

**Severity: Medium; backend validation unverified**

**Observed:** `ProfileModal.onChangeAvatar` takes `e.target.files[0]`, converts it to Base64 and passes it to `backendGateway.editUser({ u_photo: base64 })`. The inspected avatar input has no visible `accept` attribute and this handler does not validate MIME, dimensions or size.

**Impact:** arbitrary/oversized content can be sent into the profile image field unless backend validation rejects it. If later rendered as an image URL/data URL without safe transformation, content-type confusion may create additional risk.

**Recommendation:** accept only a small set of raster formats, enforce byte and dimension limits, decode/re-encode server-side, strip metadata as appropriate, store in a dedicated avatar path and return a controlled image URL. Never trust the submitted filename or MIME type.

## 5. Image retrieval and object URL lifecycle

### FILE-27-06 — Object URLs are not revoked in reviewed image loading paths

**Severity: Low/Medium (resource leak)**

**Observed:** `getImageBlob` creates object URLs using `URL.createObjectURL(res.data)`; the reviewed API helper returns the URL with no associated revocation. The JSON form and general file input also call `URL.createObjectURL` for previews. A repository search found `revokeObjectURL` in the frontend log download helper, but not in the reviewed image-preview paths.

**Impact:** repeated opening/editing of profile images or selecting/removing files can retain Blob URLs and memory until page teardown, especially in long-lived SPA sessions.

**Recommendation:** track each created object URL and revoke it when the image/file is removed, replaced, component unmounts or loading is superseded. Avoid creating a new URL during every render; memoize by File/Blob identity.

**Unverified:** whether `loadImageFiles` or another consumer revokes URLs outside the searched call sites; inspect full lifecycle before changing implementation.

## 6. Sandbox JSON import

### FILE-27-07 — Sandbox JSON import has no visible size/schema/depth validation

**Severity: Medium if route is accessible to untrusted users**

**Observed:** `pages/Sandbox/index.tsx` exposes a JSON file picker with `accept="application/JSON"`, reads the selected file fully as UTF-8 with FileReader, then calls `JSON.parse` and passes the result into the form constructor/JSON editor. The loaded settings are also written to localStorage by the editor change handler. No file-size, schema, maximum-depth or object-complexity validation is visible in this path.

**Impact:** malformed or extremely large/deep JSON can cause parse errors, memory pressure, UI hangs or downstream renderer failures. `accept` does not enforce file content. If Sandbox is available to ordinary users, it expands the attack surface for untrusted configuration input.

**Recommendation:**
- Confirm whether Sandbox is intentionally public; otherwise guard it by administrator/developer role and exclude it from production builds if unnecessary.
- Enforce a conservative file-size limit before reading.
- Validate parsed data against a strict schema, maximum nesting depth, array/object count and allowed block/component types.
- Catch parse and validation errors with a visible message; do not persist invalid data.
- Render imported content using safe text/URL rules and sanitize any rich HTML sinks.

**Related:** AUTH-26-05 notes that the route table has no explicit role guard. Backend access is not implicated by this finding, but the UI route should not be assumed private.

## 7. ZIP archive handling

### FILE-27-08 — No frontend ZIP import/extraction path found

**Severity: Informational / scope clarification**

**Observed:** repository searches for ZIP handling and common archive libraries/import paths (including `application/zip`, `JSZip`, `adm-zip`, `archiver`, `unzip`) did not identify a frontend ZIP import or extraction implementation in the selected source baseline.

**Conclusion:** this frontend baseline does not provide evidence to assess Zip Slip protections, archive entry count/size limits, decompression bombs, symlink handling or path traversal during extraction. Those controls must be reviewed in the backend/import service if ZIP archives are accepted there. Do not claim ZIP parsing is safe or unsafe based on this frontend review.

## Findings summary

| ID | Severity | Finding |
|---|---|---|
| FILE-27-01 | High if backend trusts UI validation | Only first selected registration file MIME is checked |
| FILE-27-02 | Medium | No explicit frontend file size/count/aggregate limits found |
| FILE-27-03 | High pending storage ACL verification | Upload includes `private: 0` for identity document upload path |
| FILE-27-04 | Medium | Upload response does not require explicit success and valid file ID |
| FILE-27-05 | Medium | Avatar upload has no visible file type/size validation |
| FILE-27-06 | Low/Medium | Image preview object URLs not revoked in reviewed paths |
| FILE-27-07 | Medium if route is exposed | Sandbox JSON import lacks size/schema/depth validation |
| FILE-27-08 | Informational | No frontend ZIP extraction path found; backend archive handling remains outside scope |

## Recommended remediation order

1. Verify the backend meaning of `private: 0` immediately and confirm passport/license files are not publicly accessible.
2. Verify backend file signature/content validation, size/count limits, authenticated download authorization and retention.
3. Make upload responses fail closed unless explicit success and a valid file ID are returned.
4. Validate every selected file and impose file/count/total limits in UI and backend.
5. Restrict and validate avatar uploads; store/retrieve avatars separately from identity documents.
6. Gate Sandbox or remove it from production; validate imported JSON with a strict schema and complexity limits.
7. Add object URL cleanup for previews and fetched blobs.
8. If any service accepts ZIPs, perform a separate backend archive security audit covering Zip Slip, symlinks, duplicate paths, path normalization, decompression bombs, entry counts and extraction quotas.

## Files reviewed

- `src/API/index.ts`
- `src/tools/api.ts`
- `src/tools/utils.ts`
- `src/state/user/helpers.ts`
- `src/state/user/sagas.ts`
- `src/components/Input/index.tsx`
- `src/components/JSONForm/JSONFormElement.tsx`
- `src/components/modals/LoginModal/Register.tsx`
- `src/components/modals/ProfileModal.tsx`
- `src/pages/Sandbox/index.tsx`
- `src/Routes.tsx`

## Limitations

- Backend PHP upload handlers, Dropbox/object-storage configuration, reverse-proxy limits and file-serving headers were not inspected.
- No actual file was uploaded to the live backend.
- No malicious file, MIME spoof, oversized file, malformed image or JSON stress test was executed.
- No authenticated/unauthenticated file download or cross-user file-ID access test was run.
- No storage ACL or object URL lifetime was verified in a running browser.
- No ZIP acceptance endpoint was found in the frontend; backend archive handling remains unreviewed.
- This is a source-level frontend review, not a file-upload penetration test.
