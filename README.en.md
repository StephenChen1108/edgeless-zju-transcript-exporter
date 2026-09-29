# Edgeless

Edgeless is a Microsoft Edge extension for browsing and exporting transcripts and original PPT files that you can access in Zhejiang University ZJU Cloud Classroom.

## Features

- The **Current lecture** view shows separate transcript and PPT availability. Preview the full transcript or slide thumbnails, then export or download either resource independently.
- The **Whole course** view lists lectures and their resources. Expand a lecture for its own preview and download actions, or select lectures for a batch export. Select all is supported.
- Export selected course lectures as one Markdown file or a ZIP archive. ZIP settings control combined transcripts, per-lecture transcripts, an index, and PPT files. PPT inclusion is off by default.
- Set the opening view, transcript language, timestamps, course metadata, filename format, default course export format, and theme. Preferences save automatically in browser storage.
- Generate exports locally without loading remote scripts. PPT downloads require an original file from the classroom endpoint; slide previews require slide images from that endpoint.

## Install

1. Download edgeless-edge-v0.4.0.zip from [Releases](../../releases) and extract it.
2. Open edge://extensions, enable Developer mode, and select **Load unpacked**.
3. Select the extracted edgeless-edge-v0.4.0 folder containing manifest.json.

You can also load the repository root as an unpacked extension.

## Use

Sign in to ZJU Cloud Classroom and open a replay or recorded lecture you can access. For transcripts, open the speech-recognition panel and let captions load. Open Edgeless from the Edge toolbar, then switch between the current lecture and whole course. Select the lectures you want in a course export.

If no transcript is detected, keep the speech-recognition panel open, refresh the classroom page, and reopen the extension. The extension cannot bypass course access controls. Resource and PPT availability depends on the classroom endpoints.

## Privacy

Course and resource data are read from the active classroom page when you use the extension. Preferences are stored in browser storage, and export files are generated locally. The extension does not upload transcript content, cookies, or login information to a developer server. It requests course data from ZJU Cloud Classroom itself. See the [Privacy Policy](PRIVACY.md).

## License

This repository currently has no project license. Public availability does not grant permission to redistribute or modify the project. Third-party dependency and icon terms are included in vendor/JSZip-LICENSE.markdown and icons/LUCIDE-LICENSE.
