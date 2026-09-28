# Edgeless

Edgeless is a Microsoft Edge extension for exporting available speech transcripts from Zhejiang University ZJU Cloud Classroom. Export the current lecture as Markdown, or collect available transcripts from a course into Markdown or a ZIP archive.

## Features

- Export the current lecture transcript while preserving its text, order, and timestamps.
- Export available transcripts for a course as one Markdown file or a ZIP archive.
- Configure language, timestamps, metadata, filenames, ZIP contents, and theme. Preferences stay in browser storage.
- Optionally include original PPT/PPTX files when the classroom endpoint explicitly provides them. This option is off by default.
- Generate exports locally without loading remote scripts.

## Install from a release

1. Download `edgeless-edge-v0.3.1.zip` from [Releases](../../releases) and extract it.
2. Open `edge://extensions`, enable Developer mode, and select **Load unpacked**.
3. Select the extracted folder containing `manifest.json`.

You can also load the repository root as an unpacked extension.

## Use

Sign in to ZJU Cloud Classroom and open a lecture replay you can access. Open the speech-recognition panel, then select Edgeless from the Edge toolbar. Choose the current lecture or course export.

The extension cannot bypass classroom access controls. Course export requires the course identifier to be available from the replay page or its loaded requests.

## Privacy

Course and transcript data are read from the active classroom page when you use the extension. Preferences are stored in browser storage, and export files are generated locally. The extension does not upload transcript content, cookies, or login information to a developer server. See [Privacy Policy](PRIVACY.md).

## License

This repository currently has no project license. Public availability does not grant permission to redistribute or modify the project. Third-party dependency terms are included with the dependency.

