# iPhone Shortcut: send photos and videos to OpenFrame

Select photos or videos in the Photos app → **Share** → **Send to Frame**.

**Easiest way to build it:** on the iPhone, open `http://<frame IP>:8080/shortcut` in Safari (enter the
web access PIN). That page walks through the steps with pictures of each action and Copy buttons for
the address and the upload key. This file is the same guide in text.

Status: built by the user on iOS (2026-10-13); sending several photos at once works. A video arrived
through it on 2026-10-14 (1080p HEVC, plays on the frame) but without its date and place: steps 6–7
(added 2026-10-14, Phase 12) send them. **Verified on the iPhone 2026-10-15**: a video arrived with
its date and place (named by the frame's city list), after fixing the two mistakes below.

**Already have the Shortcut?** Add the actions of step 6 you don't have yet just above your "Get Contents
of URL", and change its address as in step 7. New on 2026-10-19 (precise place names, SPEC §8): **Name**,
**URL Encode**, and `&place=`. Then export it again and upload it in Settings → Photos → iPhone Shortcut.

## The Shortcut

1. **Shortcuts** → **+** → name it **Send to Frame** → **ⓘ** → **Show in Share Sheet**.
   Top block: Receive **Images and Media** from **Share Sheet** (not "Apps and 2 more").
2. **Repeat with Each** → item in **Shortcut Input**. Steps 3–7 go inside it.
3. **Get Details of Images** → Get **Media Type** from **Repeat Item**, then **If** *Media Type*
   **is Image** (a new If comes with Otherwise / End If).
4. Under **If**: **Convert Image** → **Repeat Item** (not Shortcut Input) → **JPEG**,
   **Preserve Metadata: On**. With Shortcut Input every pass re-sends the first photo and the frame
   skips the copies (the bug in the first real test).
5. Under **Otherwise**: **Encode Media** → **Repeat Item** → Size **1920×1080** (H.264). Not "HEVC 1920×1080":
   it kept an iPhone HDR video in 10-bit HDR, which the frame refuses (2026-10-19); plain 1920×1080 turned an HDR
   video into standard 8-bit H.264 (checked on the frame, about 15 Mbps).
6. After **End If**: **Get Details of Images** → **Location** from **Repeat Item**; then
   **Get Details of Locations** → **Latitude** from **Location**, and again → **Longitude**.
   Once more → **Name** from **Location** (the place's name as the Photos app shows it), then
   **URL Encode** → **Encode** the **Name** (a name with "&" would otherwise break the address).
   (Converting a video drops its date and place; photos keep theirs, so sending them too is harmless.)
   **Not inside "Otherwise"** (seen 2026-10-15): there the If Result for a video becomes the longitude,
   and the frame answers "The Shortcut sent text instead of the photo or video".
7. Below those, still inside the repeat: **Get Contents of URL**
   - URL `http://<frame IP>:8080/api/upload?taken=` + variable **Repeat Item** → **Date Taken**,
     Date Format **ISO 8601** + `&lat=` + **Latitude** + `&lon=` + **Longitude** + `&place=` +
     **URL Encoded Text**. The `=` goes
     **before** each variable (seen 2026-10-15: `&lat`+Latitude+`=` sends no place at all).
     The date must stay **ISO 8601** (seen 2026-10-19 while adding `&place=`: the date became Shortcuts'
     default "Oct 19, 2026 at 7:46 AM"; its raw spaces end the address, so the frame got `taken=Oct` and no
     lat, lon, or place; the log says "Upload address cut at a space").
     Tap the date variable to check it says **Repeat Item**: with **Shortcut Input** every file gets the
     first one's date (seen 2026-10-16; the frame now keeps a photo's own date, but a video has none).
   - Method **POST**
   - Header `X-Upload-Key` = the upload key (Settings → Photos → iPhone Shortcut)
   - Request Body **File** → **If Result**
8. Try it from Photos. Allow local-network access the first time.
9. For several photos at once (or large videos): iPhone **Settings → Shortcuts → Advanced → Allow Sharing
   Large Amounts of Data** (found by the user, 2026-10-15); without it iOS stops the Shortcut.

Photos go full size as JPEG (the frame makes its own screen-sized copies); videos are re-encoded to
1080p H.264 8-bit (the frame plays H.264/HEVC up to 1080p, not 4K or 10-bit HDR). The frame names the
files (`upload-<date>-<time>.jpg`).

## What the frame answers

`POST /api/upload` with the file as the request body, one file per request. Optional query values:
`name`, `comment` (the upload page), `taken` (ISO 8601; also epoch seconds/ms or Shortcuts' default
"Oct 14, 2026 at 8:22 AM"), `lat` and `lon` (decimal degrees), `place` (the location's name; it wins over
the frame's OpenStreetMap lookup; a street address counts as no name). Sent place and (for videos, or photos without one) date win over the file's
own (kept per file name, so they survive the frame processing the file again).

| Answer | Meaning |
|---|---|
| `201 {"status":"saved","name":…}` | Added; shown within a few slides. |
| `200 {"status":"duplicate","existing":…}` | The exact same file is already on the frame; not saved again. |
| `415` | Not something the frame can show: HEIC/AVIF must be JPEG; only JPEG, PNG, WebP, MP4, MOV; and videos it can't play (larger than 1080p, 10-bit HDR, other codecs), with the reason. |
| `401` | Upload key missing or wrong ("The upload key is wrong…"). |
| `411` / `413` / `507` | Empty upload / over 2 GB / frame storage almost full. |

The upload key only allows adding photos and videos. "New key" in Settings replaces it (then update
step 7).

## Without the Shortcut

Open `http://<frame IP>:8080/upload` in Safari, choose photos and videos, optionally add a comment,
and tap Upload. Safari converts iPhone HEIC photos to JPEG when it hands them to the page. Videos larger
than 1080p are refused by the page before sending, with a pointer to the Shortcut.

## Still to check

- Whether **location** survives Safari's picker (the Shortcut with Preserve Metadata keeps it,
  verified 2026-10-14). It matters for the photo caption (SPEC §8).
- Whether Safari's picker keeps HEVC videos as they are or converts them.
