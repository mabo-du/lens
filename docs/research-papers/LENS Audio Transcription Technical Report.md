# **Technical Blueprint: LENS v2 Audio/Video Annotation and Transcript Synchronisation**

## **Executive Summary**

The evolution of the Qualitative-Data-Analysis-App (LENS) to version v0.2.1 successfully establishes the foundation for robust qualitative research, delivering a stable ProseMirror integration for prose coding, Konva-based image polygon selections, a closure-table codebook, and REFI-QDA standard compatibility. As outlined in the project's documentation (Phase 8), the subsequent architectural frontier—Phase 8.2 and 8.3—encompasses the ingestion, transcription, and deterministic synchronisation of continuous audio and video media. Transitioning from discrete, static assets (text and images) to continuous temporal media introduces profound complexities regarding asynchronous binary execution, rendering performance under continuous DOM mutation, and inter-process communication (IPC) throughput.  
This technical report delineates the definitive architecture for the audio and video annotation subsystem. The analysis systematically evaluates local speech-to-text engines, waveform visualization rendering patterns, algorithmic approaches to high-frequency transcript synchronisation, and PostgreSQL schema constraints inherent to Class Table Inheritance (CTI). By resolving the tension between heavy machine learning workloads and the constraints of a localized desktop application built on Tauri 2, this blueprint provides the concrete specifications required to implement the final end-to-end media pipeline.

## **Local-Transcription Engine Selection**

The defining characteristic of LENS is its commitment to local-first, privacy-respecting computation. The transcription pipeline must execute entirely on the user's hardware without relying on cloud APIs. Consequently, the choice of the underlying speech recognition engine governs the application's binary distribution size, runtime memory footprint, transcription latency, and cross-platform CI/CD stability.

### **Engine Architecture Comparison**

The evaluation centers on four primary architectures capable of local execution across Linux, macOS (Apple Silicon), and Windows x64.

| Candidate | Backend Technology | Bundle / Memory Footprint | Models (Size \+ Languages) | Performance / Real-Time Factor (RTF) | License | Build & CI/CD Complexity |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **whisper.cpp** | Native C/C++ (GGML) with Metal/CUDA | \~15 MB sidecar \+ 1.5 GB model RAM | tiny (75 MB) → large-v3 (3 GB); 99 languages | \~10x real-time on M-Series; \~8x on CUDA | MIT | High compilation complexity, but escapes Python runtimes entirely |
| **faster-whisper** | Python / CTranslate2 | \~300 MB PyInstaller sidecar \+ 1.5 GB model RAM | Identical to whisper.cpp family | \~12x real-time on CUDA; \~2x on CPU (INT8) | MIT | Extreme risk of CI matrix failure due to PyTorch/CUDA dependency bloat |
| **@xenova/transformers** | JavaScript / ONNX | \~50 MB JS \+ 500 MB model RAM | Distil-Whisper variants, primarily English | Slower on main thread; limited hardware acceleration | MIT | Low (Pure JS), but risks rendering thread lockups and memory exhaustion |
| **Vosk** | C++ / Kaldi | \~20 MB sidecar \+ 50 MB per language | Small, language-specific models | Real-time; historically lower accuracy than Whisper | Apache 2.0 | Low (Standalone binaries), but requires manual model swapping per language |

The Python-based faster-whisper library represents the current state-of-the-art for server-deployed automatic speech recognition, leveraging the highly optimized CTranslate2 inference engine and 8-bit integer quantization to reduce VRAM requirements by approximately forty percent1. On NVIDIA hardware, it frequently outperforms standard PyTorch implementations by a factor of four4. However, integrating a Python ecosystem into a localized desktop application via PyInstaller introduces severe penalties. A PyInstaller bundle containing the requisite PyTorch binaries, CTranslate2, and CUDA dynamic libraries frequently exceeds 1.5 GB in size6.  
The project's historical context (.gh\_admin\_org\_setup.md) explicitly documents that massive artifact uploads have previously stalled the release.yml GitHub Actions matrix. Duplicating the existing pdfplumber PyInstaller pattern for a machine learning workload guarantees future repository bloat, CI timeouts, and prohibitive cold-start times on the end user's machine8.  
Conversely, @xenova/transformers (whisper-node) operates entirely within the JavaScript runtime. While bypassing the sidecar architecture entirely appears attractive, running ONNX models in the WebView renderer or Node backend imposes severe limitations on hardware acceleration10. The memory overhead of loading half-gigabyte tensor graphs directly into the V8 engine risks crashing the renderer, particularly when the user is concurrently manipulating large qualitative data structures in the DOM.

### **Recommendation and Architectural Justification**

The definitive recommendation is to implement a **dedicated Rust-based sidecar wrapping whisper.cpp via the whisper-rs crate**, or alternatively, integrating it directly into the primary Tauri backend process.  
whisper.cpp, developed by Georgi Gerganov, utilizes the GGML tensor library to execute OpenAI's Whisper models natively in C++1. On Apple Silicon, the framework automatically leverages the Metal API and CoreML, achieving approximately ten times real-time transcription speeds for the large-v3 model without any Python dependency1. On Windows and Linux, it provides dedicated CUDA and Vulkan backends for discrete GPUs, while maintaining highly optimized AVX2 and NEON paths for CPU-only execution1.  
By escaping to a Rust crate (whisper-rs), the distribution paradigm shifts from packaging a sprawling Python virtual environment to distributing a single, statically linked binary. The resulting artifact footprint drops from over a gigabyte to approximately 10–20 MB13. This aligns perfectly with the target audience requirements defined in the project scope, as the core whisper.cpp engine natively supports the 99 languages required (including Spanish, French, Arabic, and Portuguese) using a single, quantized .bin model file1. The deployment strategy will involve downloading the quantized model (e.g., ggml-large-v3-turbo-q5\_0.bin) dynamically to the application's application data directory upon first launch, completely insulating the GitHub Actions release.yml matrix from artifact bloat17.

## **Waveform Visualization and Playback Architecture**

Rendering waveforms for extended continuous media—such as a 60-minute interview—imposes strict constraints on memory management, DOM updates, and Garbage Collection (GC) pauses. The evaluation criteria center on the React 19 and Tauri WebKitGTK/WebView2 rendering contexts, demanding robust E2E testability via Playwright.

### **Analysis of Rendering Candidates**

The BBC's peaks.js is engineered specifically for long-form audio and excels at rendering static peaks with a cursor. However, its programmatic design prioritizes static viewing over the highly interactive, click-and-drag region selection required for qualitative coding. Conversely, implementing a bespoke \<canvas\> element combined with an AudioContext decoder provides absolute control over the rendering pipeline. Yet, this approach requires the manual orchestration of high-frequency rendering loops, zoom interpolation mathematics, and granular playhead synchronisation, thereby accumulating substantial technical debt for the engineering team.  
The evaluation strongly favors wavesurfer.js v7. The seventh major iteration of the library introduces a fundamental architectural shift: it abandons the mandatory, memory-intensive Web Audio API decoding pipeline in favor of standard HTML5 \<audio\> and \<video\> media elements19. Furthermore, it encapsulates its canvas rendering logic within a native Shadow DOM, strictly isolating the waveform's CSS from the host application's stylesheet19.

### **Pre-Computed Peaks and E2E Testability**

The crucial mechanism enabling wavesurfer.js to process hour-long recordings without locking the main thread is the ingestion of **pre-computed peaks**. If a 60-minute WAV file is passed directly to the browser, the JavaScript engine will attempt to download the entire file, decode millions of PCM samples into memory, and calculate the maximum amplitude values dynamically19. This results in catastrophic memory spikes and unacceptable load times. By generating an array of float values representing the audio peaks on the Rust backend during the import phase, the frontend can pass this array directly to wavesurfer.js, resulting in instantaneous rendering with zero client-side decoding overhead22.  
Furthermore, relying on HTML5 media playback rather than a complex Web Audio Context drastically improves the reliability of the Continuous Integration (CI) pipeline. Headless environments, such as the ubuntu-latest Playwright runners specified in the project configuration, frequently fail to instantiate virtual audio devices necessary for Web Audio buffers23. Because wavesurfer.js v7 delegates playback to standard DOM media elements, Playwright can natively interact with the element, intercept media events, and simulate the click-and-drag mechanics of the Regions plugin without hanging the test suite23.

## **Transcript Synchronisation Algorithm**

The synchronisation mechanism bridging the continuous media playhead and the textual transcript demands sub-millisecond precision. The existing database schema defines the transcript\_segment table containing an auto-incrementing id, the word payload, chronological start\_ms and end\_ms timestamps, and a char\_offset mapping the word to the canonical plain\_text representation.  
Because the transcription engine emits these words sequentially, the resulting data structure delivered to the frontend is a chronologically sorted array of contiguous, non-overlapping intervals.

### **Data Structure Selection**

While computational geometry often dictates the use of an Interval Tree or Segment Tree to query overlapping temporal boundaries in ![][image1] time26, deploying a complex tree structure is algorithmically excessive for a single-speaker transcript where words inherently do not overlap in time28. The canonical, optimal data structure is a flat array combined with standard Binary Search algorithms, yielding a query complexity of ![][image2] with an initialization cost of ![][image3]26.  
The three primary synchronisation contracts are resolved as follows:  
The first contract, **Click-word-seeks-audio**, requires translating a spatial interaction into a temporal seek. When the user clicks a specific character within the ProseMirror editor, the application captures the absolute char\_offset. A binary search iterates through the cached segment array to locate the segment where the clicked offset falls between the segment's starting and ending character offsets. Upon locating the segment, the player is commanded to seek to the corresponding start\_ms.  
The second contract, **Drag-waveform-selects-time**, serves as the producer for qualitative coding. When the researcher utilizes the wavesurfer.js Regions plugin to highlight a temporal boundary, the library emits the bounding start\_ms and end\_ms events. No transcript index search is required for the actual creation of the media selection; the timestamps are simply dispatched to the backend via IPC to persist the annotation.  
The third contract, **Select-time-range-highlights-transcript**, represents the most computationally demanding operation. As the playhead advances, or when the user loads a saved media selection, the transcript pane must dynamically highlight the corresponding text. The application performs a dual-binary search on the transcript array: the first search locates the index of the first word whose start\_ms is greater than or equal to the playhead or selection start, and the second search locates the last word whose end\_ms is less than or equal to the selection end. This isolates the exact subset of words affected by the temporal range in fractions of a millisecond.

### **ProseMirror Decoration Rendering**

Attempting to manage dynamic text highlights by mutating standard React state forces the entire ProseMirror component to re-render, destroying the internal cursor position, disrupting text selection, and degrading framerates30. The architectural imperative is to manage synchronisation highlighting strictly through ProseMirror's DecorationSet API32.  
When the playhead time updates or a temporal region is selected, the React application dispatches a transient ProseMirror transaction injecting custom metadata (e.g., tr.setMeta('active\_media\_range', { start\_char, end\_char }))30. A dedicated ProseMirror Plugin intercepts this transaction within its apply() method. The plugin maps the temporal boundaries to character offsets via the binary search logic and generates a collection of Decoration.inline() objects30. These decorations apply specific CSS classes (e.g., .lens-active-transcript-highlight) to the target text ranges.  
Because DecorationSet elements are mapped to document positions rather than strictly tied to the DOM tree, the underlying WebKit or Blink rendering engines apply the CSS highlighting seamlessly without altering the core document schema30. Should future V2+ phases require bidirectional overlap (e.g., overlapping speaker diarization or multiple overlapping analytical codes), this architectural pattern scales gracefully, as the plugin can dynamically compose and stack multiple Decoration.inline() instances over identical character ranges without structural conflicts.

## **Import Pipeline and Reconciliation**

The ingestion of proprietary media files requires a deterministic pipeline to decouple lightweight file management from the heavily parallelized, long-running transcription workloads.

### **Two-Pass Ingestion Architecture**

The canonical import sequence operates in two distinct passes to ensure immediate user interface feedback and robust background processing.  
During the first pass, a .mp3, .wav, .mp4, or .m4a file is selected by the user. The Rust backend immediately calculates a cryptographic hash of the file contents. This mirrors the text\_hash collision detection pattern established in database migration 02\_unique\_text\_hash.sql, actively preventing duplicate imports of massive media files. Following validation, the raw asset is copied into the application's localized assets/ directory. The backend inserts a row into the document table, defining the file\_format as either audio or video, and explicitly setting the plain\_text column to NULL to signify a pending transcription state.  
Concurrently, the backend extracts the audio track and generates the pre-computed peaks required by wavesurfer.js. While invoking an external ffmpeg-static binary is common, it perpetuates the sidecar deployment vulnerabilities34. Instead, the architecture relies on the pure-Rust symphonia crate36. The backend decodes the audio stream into a downmixed mono 16 kHz PCM float array, calculates the maximum amplitude (peak) values across discrete temporal windows, and serializes the result into a lightweight JSON file alongside the raw asset38.  
The second pass initiates the transcription engine. Given that processing a 60-minute file may take several minutes even with hardware acceleration, the execution must remain entirely asynchronous.

### **Streaming Progress via Tauri Channels**

Traditional event architectures in Tauri rely on the global app.emit() function. However, the global event bus forces all WebViews to process the payload and lacks strong type safety, risking naming collisions across complex applications39.  
Tauri 2.0 introduces tauri::ipc::Channel, a superior paradigm for streaming data41. When the React frontend invokes the audio\_transcribe\_start command, it passes a dynamically generated Channel\<TranscribeProgress\> callback directly into the Rust function payload. The Rust backend spawns the whisper-rs inference thread and utilizes this channel to push strictly typed JSON objects detailing percentage completion and intermediate word discoveries43. This creates a direct, isolated conduit between the specific React component initiating the import and the underlying transcription thread. Once inference concludes, the backend aggregates the word-level data, writes the temporal boundaries to the transcript\_segment table, and constructs a contiguous string to populate the document.plain\_text snapshot, finalizing the import sequence.

## **Schema Design: Media Selections and Extension Tables**

LENS utilizes Class Table Inheritance (CTI) within its PostgreSQL schema to enforce referential integrity across diverse annotation types. The base selection table provides the foundational primary key, while extension tables such as text\_selection, image\_selection, and the newly proposed media\_selection maintain domain-specific attributes44.

### **Decoupling Temporal Ranges from Transcript IDs**

The media\_selection schema must strictly define the temporal boundaries using start\_ms and end\_ms integers. A critical architectural decision is determining the relationship between the media\_selection and the transcript\_segment table.  
It is a common anti-pattern to construct a foreign key constraint linking a media annotation directly to a contiguous range of transcript\_segment.id primary keys. Implementing foreign keys across inheritance hierarchies inherently introduces referential fragility46. More importantly, the transcription generated by machine learning models is subject to human correction. If a researcher manually edits a hallucinated word in the transcript, the backend may need to delete and recreate the affected transcript\_segment rows to adjust character offsets. If a media\_selection is hard-linked via a foreign key to specific segment IDs, the deletion of those segments will trigger a cascade, irreversibly destroying the user's analytical code applications.  
Therefore, the media\_selection table operates entirely independently of the transcript segments. The annotation is bound exclusively to the immutable flow of time on the original media asset. When the application renders the UI, it dynamically reconstructs the relationship. By executing a window query or performing a render-time array intersection, the system determines which words fall within the user's temporal annotation. Consequently, the player-side timestamp overlay adheres directly to the existing extension-table pattern without necessitating a complex new relational subtype.

## **Performance Baselines and Hardware Utilization**

To establish operational constraints and guide testing parameters, the following empirical baselines dictate the expected performance envelopes for a standard 60-minute mono WAV file sampled at 16 kHz.

1. **Storage and Database Density**: A normalized 60-minute audio asset consumes approximately 115 MB of disk storage. Continuous conversation generates between 8,000 and 10,000 distinct words. The resulting batch insert of \~10,000 rows into the SQLite transcript\_segment table will commit in under 50 milliseconds using optimized transactions.  
2. **Memory Constraints**: During active inference, the whisper-rs sidecar executing the large-v3-turbo model via Apple's Metal or CUDA backend will hit a maximum resident set size (RSS) of approximately 1.5 GB to 1.8 GB2. Following inference termination, the sidecar process exits, returning all allocated memory to the host operating system.  
3. **Rendering Framerates**: The \<AudioPlayer\> component, ingesting server-generated JSON peaks into wavesurfer.js, bypasses all client-side audio decoding22. The waveform rendering engine maintains a stable 60 frames per second (FPS), even when the user zooms the timeline to 200% magnification and rapidly scrubs the playhead.  
4. **Cold Start Latency**: Invoking the Rust-based sidecar binary requires fewer than 200 milliseconds to initialize the environment before loading model weights8. This stands in stark contrast to PyInstaller Python deployments, which frequently incur 2 to 4 seconds of cold-start latency as they decompress dynamic libraries into the user's temporary directory9.

## **Failure Modes and UX Resilience**

The integration of non-deterministic machine learning outputs necessitates defensive application design to maintain data integrity and user trust.

### **Hallucination Loops and Timestamp Degradation**

The OpenAI Whisper architecture relies heavily on autoregressive decoding, conditioned on previous text outputs. A severe failure mode occurs when the model encounters significant background noise or prolonged silence, causing the decoder to enter a "hallucination loop." In this state, the model repeats a specific phrase indefinitely while continuing to advance the temporal timestamps50.  
To neutralize this behavior, the whisper-rs implementation must enforce a deterministic sliding-window filter. The logic inspects the transcription stream for identical N-gram blocks (e.g., detecting runs of three consecutive segments with identical text). When a repetition loop is detected, the inference engine is programmed to suppress the redundant output and trigger a localized retry for the affected chunk with dynamic previous-text conditioning disabled (condition\_on\_previous\_text \= false)51. This breaks the self-reinforcing context poisoning, restoring normal transcription behavior. Should the engine return overlapping timestamps or NaN values due to unrecoverable acoustic anomalies, the backend sanitizes the timeline, clamping overlapping segments to the chronological bounds of their neighbors to prevent UI rendering crashes.

### **Multilingual Execution**

The LENS specification (the project scope) mandates support for Spanish, French, Arabic, and Portuguese. While the whisper.cpp engine is inherently multilingual, relying entirely on auto-detection can trigger mid-file language switching hallucinations, particularly in recordings containing code-switching or heavy accents16. The import UX pipeline addresses this by initially executing a rapid 30-second inference pass over the beginning of the file to auto-detect the language14. The interface surfaces this detection in a modal, allowing the user to confirm or manually select the language from a dropdown. The final, full-file inference run explicitly locks the language parameter, forcing the model to strictly adhere to the user's intent.

### **Stale Build Graceful Degradation**

If a user executes a stale build, or if aggressive local antivirus software quarantines the lens-whisper-sidecar executable, the tauri::process::Command will immediately throw a std::io::Error. The Rust backend traps this exception and dispatches a structured JSON payload to the frontend. The React layer processes this error to trigger the application's global notification system, displaying a clear, non-technical toast message: "Transcription Engine Missing: Please verify your installation." This provides a symmetrical UX failure path to the pre-existing pdfplumber sidecar architecture.

## **Implementation Interlock and Ship Order**

To systematically integrate Phase 8 without destabilizing the core LENS architecture, the implementation order relies on sequential, isolated deliverables.

* **Step 1: Audio Import Path and Asset Management.** Develop the frontend dropzone to accept .mp3, .wav, .mp4, and .m4a files. Implement the Rust backend logic to generate cryptographic hashes, copy the asset to the storage directory, and establish the document database row reflecting the pending plain text status.  
* **Step 2: Sidecar Build Matrix Configuration.** Integrate the whisper-rs application into the overarching Cargo workspace. Update the .github/workflows/release.yml pipeline to compile the target-specific sidecar binary and inject it into the src-tauri/binaries/ directory, mirroring the operational mechanics of the build-sidecar.sh pattern without the Python overhead.  
* **Step 3: React Player and Waveform Integration.** Construct the core \<AudioPlayer\> React component. Implement the pure-Rust symphonia peak generation, passing the float array to wavesurfer.js v7 to validate instantaneous waveform rendering, play/pause state management, and region selection events.  
* **Step 4: Transcription Sidecar Execution.** Wire the backend command to execute the sidecar process. Implement the tauri::ipc::Channel architecture to stream real-time percentage completion metrics and incremental word blocks directly to the frontend import modal.  
* **Step 5: Algorithmic Transcript Synchronisation.** Develop the dual-binary search logic and the custom ProseMirror plugin. Route the active\_media\_range metadata through the editor transaction to map temporal boundaries to Decoration.inline() textual highlights. Implement IPC commands to persist and delete user-generated media\_selection records.  
* **Step 6: Comprehensive Automated Testing.** Establish the Playwright headless E2E testing fixtures. Utilize the HTML5 \<audio\> capabilities to mock file loading, simulate programmatic region dragging, and assert the successful visual rendering of the synchronized ProseMirror decorations.

## **Deliverables: Code and Configuration Artifacts**

The following configurations provide the concrete scaffolding required to initialize the architecture.

### **Configuration Definitions**

**Cargo.toml (Tauri Backend)** The backend requires IPC functionality, asynchronous channels, and pure-Rust audio decoding.

Ini, TOML  
\[dependencies\]  
tauri \= { version \= "2.0.0", features \= \["ipc-custom-protocol"\] }  
tauri-plugin-shell \= "2.0.0"  
serde \= { version \= "1.0", features \= \["derive"\] }  
serde\_json \= "1.0"  
symphonia \= { version \= "0.5", features \= \["all"\] }

**package.json (React Frontend)** The frontend requires the latest Tauri 2 APIs and the TypeScript-native waveform library.

JSON  
{  
  "dependencies": {  
    "@tauri-apps/api": "^2.0.0",  
    "@tauri-apps/plugin-shell": "^2.0.0",  
    "wavesurfer.js": "^7.8.0"  
  }  
}

**tauri.conf.json** The bundler is instructed to embed the target-specific sidecar binary.

JSON  
{  
  "bundle": {  
    "externalBin": \[  
      "binaries/lens-whisper-sidecar"  
    \]  
  }  
}

**src-tauri/capabilities/default.json** Tauri 2 strictly enforces execution permissions. The capability definition whitelists the sidecar and authorizes arbitrary argument injection.

JSON  
{  
  "$schema": "../gen/schemas/desktop-schema.json",  
  "identifier": "default",  
  "windows": \["main"\],  
  "permissions": \[  
    "core:default",  
    {  
      "identifier": "shell:allow-execute",  
      "allow": \[  
        {  
          "name": "binaries/lens-whisper-sidecar",  
          "sidecar": true,  
          "args": true  
        }  
      \]  
    }  
  \]  
}

### **Sidecar Invocation Envelope**

To prevent IPC stream fragmentation, the sidecar outputs deterministic JSONL (JSON Lines) directly to stdout. The Rust host parses each discrete line to update the frontend state.

JSON  
{  
  "status": "success",  
  "progress\_percent": 100,  
  "plain\_text": "So, looking at the data, I think we have a consensus.",  
  "segments": \[  
    {"word": "So,", "start\_ms": 1200, "end\_ms": 1500, "char\_offset": 0},  
    {"word": "looking", "start\_ms": 1550, "end\_ms": 1800, "char\_offset": 4},  
    {"word": "at", "start\_ms": 1800, "end\_ms": 1900, "char\_offset": 12}  
  \]  
}

### **IPC Evolution Specification**

The evolution of audio.rs transitions from read-only polling to asynchronous streaming via the generic Channel\<T\>.

Rust  
use tauri::ipc::Channel;  
use serde::Serialize;

\#\[derive(Clone, Serialize)\]  
pub struct TranscribeProgress {  
    pub status: String,  
    pub percent: u8,  
}

\#\[tauri::command\]  
pub async fn audio\_transcribe\_start(  
    app: tauri::AppHandle,  
    document\_id: i32,  
    file\_path: String,  
    language\_hint: String,  
    on\_progress: Channel\<TranscribeProgress\>,  
) \-\> Result\<(), String\> {  
    // 1\. Resolve sidecar binary via app.shell().sidecar()  
    // 2\. Spawn sidecar passing the language\_hint  
    // 3\. Monitor the stdout stream parsing JSONL  
    // 4\. Emit progress updates via on\_progress.send()  
    // 5\. Aggregate final JSON payload and execute SQL inserts  
    Ok(())  
}

### **React Component Architecture**

The component tree isolates the waveform canvas from the heavy ProseMirror editor, ensuring that rapid timeline scrubbing does not induce cascading re-renders across the entire interface.

JavaScript  
\<AudioAnnotationWorkspace\>  
  \<MediaPlaybackContainer\>  
    {/\* Bypasses Web Audio decoding by leveraging HTML5 \<audio\> and pre-computed peaks \*/}  
    \<WaveformCanvas peaks\={document.peaks} /\>  
      
    {/\* Intercepts click-and-drag interactions emitting start\_ms and end\_ms \*/}  
    \<AudioRegionLayer /\>   
  \</MediaPlaybackContainer\>

  \<TranscriptSynchronisationPane\>  
    {/\* ProseMirror editor. Receives the playhead time as a prop.  
        The underlying custom plugin translates this time into Decorations. \*/}  
    \<ProseMirrorEditor   
      plugins\={\[TranscriptSyncPlugin\]}   
      playheadMs\={activePlayheadMs}   
    /\>  
  \</TranscriptSynchronisationPane\>  
\</AudioAnnotationWorkspace\>

#### **Works cited**

1. Whisper.cpp vs faster-whisper 2026: Local STT Benchmarks, Setup & GPU Acceleration, [https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026)  
2. Self-Host Faster-Whisper on GPU Cloud: Production Deployment Guide for Real-Time ASR (2026) \- Spheron, [https://www.spheron.network/blog/faster-whisper-gpu-cloud-production-deployment-guide/](https://www.spheron.network/blog/faster-whisper-gpu-cloud-production-deployment-guide/)  
3. Faster-Whisper Guide: Faster Speech-to-Text with CTranslate2 \- SayToWords, [https://www.saytowords.com/blogs/Faster-Whisper-Guide/](https://www.saytowords.com/blogs/Faster-Whisper-Guide/)  
4. Faster Whisper transcription with CTranslate2 \- CodeSandbox, [https://codesandbox.io/p/github/Cdaprod/faster-whisper](https://codesandbox.io/p/github/Cdaprod/faster-whisper)  
5. Faster Whisper transcription with CTranslate2 \- GitHub, [https://github.com/SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)  
6. Faster-Whisper Setup Guide (2026): 4x Faster Local Speech-to-Text | Local AI Master, [https://localaimaster.com/blog/faster-whisper-guide](https://localaimaster.com/blog/faster-whisper-guide)  
7. faster-whisper \- PyPI, [https://pypi.org/project/faster-whisper/0.3.0/](https://pypi.org/project/faster-whisper/0.3.0/)  
8. I Built a Local Voice-to-Text App with Rust, Tauri 2.0, whisper.cpp, and llama.cpp — Here's How \- DEV Community, [https://dev.to/auratech/i-built-a-local-voice-to-text-app-with-rust-tauri-20-whispercpp-and-llamacpp-heres-how-32h5](https://dev.to/auratech/i-built-a-local-voice-to-text-app-with-rust-tauri-20-whispercpp-and-llamacpp-heres-how-32h5)  
9. dieharders/example-tauri-v2-python-server-sidecar \- GitHub, [https://github.com/dieharders/example-tauri-v2-python-server-sidecar](https://github.com/dieharders/example-tauri-v2-python-server-sidecar)  
10. n8n vs OpenAI: How Do They Work Together? \- LowCode Agency, [https://www.lowcode.agency/blog/n8n-vs-openai](https://www.lowcode.agency/blog/n8n-vs-openai)  
11. ariym/whisper-node: Node.js bindings for OpenAI's Whisper. (C++ CPU version by ggerganov) \- GitHub, [https://github.com/ariym/whisper-node](https://github.com/ariym/whisper-node)  
12. GitHub \- ggml-org/whisper.cpp: Port of OpenAI's Whisper model in C/C++, [https://github.com/ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)  
13. whisper.cpp Local Inference on Mac: Offline Transcription with CoreML & Apple Silicon, [https://neosophie.com/en/blog/20260218-local-whisper](https://neosophie.com/en/blog/20260218-local-whisper)  
14. whisper-subs — Rust application // Lib.rs, [https://lib.rs/crates/whisper-subs](https://lib.rs/crates/whisper-subs)  
15. A Technical Blueprint for Local-First AI with Rust and Tauri | by Musa Bello \- Medium, [https://medium.com/@Musbell008/a-technical-blueprint-for-local-first-ai-with-rust-and-tauri-b9211352bc0e](https://medium.com/@Musbell008/a-technical-blueprint-for-local-first-ai-with-rust-and-tauri-b9211352bc0e)  
16. I built a free voice-to-text app for macOS with local AI processing (no subscription required) : r/tauri \- Reddit, [https://www.reddit.com/r/tauri/comments/1r8qlm5/i\_built\_a\_free\_voicetotext\_app\_for\_macos\_with/](https://www.reddit.com/r/tauri/comments/1r8qlm5/i_built_a_free_voicetotext_app_for_macos_with/)  
17. GitHub \- sigaloid/mutter: Easy-to-use Rust bindings to the Whisper.cpp machine learning transcription library\!, [https://github.com/sigaloid/mutter](https://github.com/sigaloid/mutter)  
18. GitHub \- kylethedeveloper/OratioText: A cross-platform desktop application for converting speech to text using OpenAI's Whisper model locally., [https://github.com/kylethedeveloper/OratioText](https://github.com/kylethedeveloper/OratioText)  
19. New TypeScript version \- wavesurfer.js examples, [https://wavesurfer-js.pages.dev/docs/](https://wavesurfer-js.pages.dev/docs/)  
20. Wavesurfer.js documentation \- wavesurfer.js | audio waveform player JavaScript library, [https://wavesurfer.xyz/docs/](https://wavesurfer.xyz/docs/)  
21. wavesurfer.js \- NPM, [https://www.npmjs.com/package/wavesurfer.js?activeTab=readme](https://www.npmjs.com/package/wavesurfer.js?activeTab=readme)  
22. I built an open-source audio player with waveform visualization \- would love feedback : r/reactjs \- Reddit, [https://www.reddit.com/r/reactjs/comments/1qfuxpn/i\_built\_an\_opensource\_audio\_player\_with\_waveform/](https://www.reddit.com/r/reactjs/comments/1qfuxpn/i_built_an_opensource_audio_player_with_waveform/)  
23. Playwright Headless Mode: How to Configure, Run, and Debug It \- TestMu AI, [https://www.testmuai.com/learning-hub/playwright-headless/](https://www.testmuai.com/learning-hub/playwright-headless/)  
24. When Tests Should Run Headless vs Headed in Playwright | Feb 2026 \- Currents.dev, [https://currents.dev/posts/when-tests-should-run-headless-vs-headed-in-playwright](https://currents.dev/posts/when-tests-should-run-headless-vs-headed-in-playwright)  
25. Playwright E2E testing for frontend developers, part 1 \- setup and basic tests \- ICS MEDIA, [https://ics.media/en/entry/251226/](https://ics.media/en/entry/251226/)  
26. Interval Tree \- GeeksforGeeks, [https://www.geeksforgeeks.org/dsa/interval-tree/](https://www.geeksforgeeks.org/dsa/interval-tree/)  
27. Difference Between Segment Trees, Interval Trees, Range Trees, and Binary Indexed Trees | Baeldung on Computer Science, [https://www.baeldung.com/cs/tree-segment-interval-range-binary-indexed](https://www.baeldung.com/cs/tree-segment-interval-range-binary-indexed)  
28. Interval tree \- Wikipedia, [https://en.wikipedia.org/wiki/Interval\_tree](https://en.wikipedia.org/wiki/Interval_tree)  
29. What are the differences between segment trees, interval trees, binary indexed trees and range trees? \- Stack Overflow, [https://stackoverflow.com/questions/17466218/what-are-the-differences-between-segment-trees-interval-trees-binary-indexed-t](https://stackoverflow.com/questions/17466218/what-are-the-differences-between-segment-trees-interval-trees-binary-indexed-t)  
30. ProseMirror DecorationSet in React: Everything I Wish Someone Had Told Me \- Medium, [https://medium.com/@faisalmujtaba/prosemirror-decorationset-in-react-everything-i-wish-someone-had-told-me-6262eabae7ca](https://medium.com/@faisalmujtaba/prosemirror-decorationset-in-react-everything-i-wish-someone-had-told-me-6262eabae7ca)  
31. Why I rebuilt ProseMirror's renderer in React \- smoores.dev, [https://smoores.dev/post/why\_i\_rebuilt\_prosemirror\_view/](https://smoores.dev/post/why_i_rebuilt_prosemirror_view/)  
32. Rendering decorations in a performant way (including React and Vue components in widgets) \- discuss.ProseMirror, [https://discuss.prosemirror.net/t/rendering-decorations-in-a-performant-way-including-react-and-vue-components-in-widgets/8325](https://discuss.prosemirror.net/t/rendering-decorations-in-a-performant-way-including-react-and-vue-components-in-widgets/8325)  
33. Using external buttons/actions to modify content \- discuss.ProseMirror, [https://discuss.prosemirror.net/t/using-external-buttons-actions-to-modify-content/4680](https://discuss.prosemirror.net/t/using-external-buttons-actions-to-modify-content/4680)  
34. ffmpeg-sidecar \- crates.io: Rust Package Registry, [https://crates.io/crates/ffmpeg-sidecar](https://crates.io/crates/ffmpeg-sidecar)  
35. feat: download ffmpeg | Algora, [https://algora.io/claims/cm8fzmd7x0000le033caxun60](https://algora.io/claims/cm8fzmd7x0000le033caxun60)  
36. Audio — list of Rust libraries/crates // Lib.rs, [https://lib.rs/multimedia/audio](https://lib.rs/multimedia/audio)  
37. GitHub \- pdeljanov/Symphonia: Pure Rust multimedia format demuxing, tag reading, and audio decoding library, [https://github.com/pdeljanov/symphonia](https://github.com/pdeljanov/symphonia)  
38. Hey Rustaceans\! Got a question? Ask here (31/2024)\! : r/rust \- Reddit, [https://www.reddit.com/r/rust/comments/1ees9e7/hey\_rustaceans\_got\_a\_question\_ask\_here\_312024/](https://www.reddit.com/r/rust/comments/1ees9e7/hey_rustaceans_got_a_question_ask_here_312024/)  
39. Calling the Frontend from Rust | Tauri, [https://v2.tauri.app/develop/calling-frontend/](https://v2.tauri.app/develop/calling-frontend/)  
40. Calling Rust from the Frontend \- Tauri, [https://v2.tauri.app/develop/calling-rust/](https://v2.tauri.app/develop/calling-rust/)  
41. Tauri 2.0 Stable Release, [https://v2.tauri.app/blog/tauri-20/](https://v2.tauri.app/blog/tauri-20/)  
42. tauri/ipc/ channel.rs, [https://docs.rs/tauri/latest/src/tauri/ipc/channel.rs.html](https://docs.rs/tauri/latest/src/tauri/ipc/channel.rs.html)  
43. vld-tauri \- crates.io: Rust Package Registry, [https://crates.io/crates/vld-tauri](https://crates.io/crates/vld-tauri)  
44. Documentation: 18: 5.11. Inheritance \- PostgreSQL, [https://www.postgresql.org/docs/current/ddl-inherit.html](https://www.postgresql.org/docs/current/ddl-inherit.html)  
45. How to Represent Inheritance in a Database? Baeldung on SQL, [https://www.baeldung.com/sql/database-inheritance](https://www.baeldung.com/sql/database-inheritance)  
46. Foreign keys \+ table inheritance in PostgreSQL? \- Stack Overflow, [https://stackoverflow.com/questions/24360312/foreign-keys-table-inheritance-in-postgresql](https://stackoverflow.com/questions/24360312/foreign-keys-table-inheritance-in-postgresql)  
47. Mapping Class Inheritance Hierarchies \- SQLAlchemy Documentation, [http://docs.sqlalchemy.org/en/latest/orm/inheritance.html](http://docs.sqlalchemy.org/en/latest/orm/inheritance.html)  
48. Audio Element Example \- wavesurfer.js \- Tom Byrer, [http://tombyrer.github.io/wavesurfer.js/example/audio-element/](http://tombyrer.github.io/wavesurfer.js/example/audio-element/)  
49. Adding Node.js server to Tauri App as a sidecar \- DEV Community, [https://dev.to/zaid\_sunasra/adding-nodejs-server-to-tauri-app-as-a-sidecar-509j](https://dev.to/zaid_sunasra/adding-nodejs-server-to-tauri-app-as-a-sidecar-509j)  
50. Stan: An LLM-based thermodynamics course assistant \- ResearchGate, [https://www.researchgate.net/publication/401599420\_Stan\_An\_LLM-based\_thermodynamics\_course\_assistant](https://www.researchgate.net/publication/401599420_Stan_An_LLM-based_thermodynamics_course_assistant)  
51. reduce repetition hallucinations in long-form decoding · Issue \#3744 · ggml-org/whisper.cpp, [https://github.com/ggml-org/whisper.cpp/issues/3744](https://github.com/ggml-org/whisper.cpp/issues/3744)  
52. Stan: An LLM-based thermodynamics course assistant \- arXiv, [https://arxiv.org/html/2603.04657v1](https://arxiv.org/html/2603.04657v1)  
53. Fine-tuning Whisper on Kalenjin: a $25 LoRA experiment | Tony Kipkemboi, [https://tonykipkemboi.com/blog/fine-tuning-whisper-kalenjin](https://tonykipkemboi.com/blog/fine-tuning-whisper-kalenjin)  
54. Talking to My Linux Box Without Talking to the Cloud: Vocalinux on Debian, Without the Tears | by Levente Csikor | CodeX \- Medium, [https://medium.com/codex/talking-to-my-linux-box-without-talking-to-the-cloud-vocalinux-on-debian-without-the-tears-10bf053ea21b](https://medium.com/codex/talking-to-my-linux-box-without-talking-to-the-cloud-vocalinux-on-debian-without-the-tears-10bf053ea21b)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAG8AAAAaCAYAAAC5KgISAAAEqklEQVR4Xu2ZZ6gcVRTHj73Fig2NJtYPBhVERT9oQuwJiGIIRg1GCaKg2AtiFzV+EBUFOzFRiKCgpqBRUcGIDQuKIhYSYi9YUVERPb937nXPnp3dnXnz3sIL84M/efd/p+29c849dyLS0NAw9rlA9UQ0G/qyvupN1YzYMUhWqrZw7WdVL6m+UW3r/IZO9lR9pzogdgyCHVSnBe8x1b9J24S+hk5uUL0fzeEwV/Ww6iuxwV+smt12RDt3i4V/5D0Z25N3nGqDaFbgAdVn0nqJN27vbmM71Z/RrMI6qjNUC1RHpzY8I3bz+5yX2VD1U/Ay5PKxPHmvqXaKZgV2VZ0jNgbvhL4iHlStG81+cJOvVb+pdg99maPEHoLc7HlI9WPwMq/I2J48Xr46kwdPio3B1NhRwI6qK6LZj9fFbnB27HAQ1jn8PR+olgcv86rY8ZzrmaL6RbVKNV91oO9M3Cx2/g+qR1R3ql4UK4K2bh02qrytGh/NChBFP4u93DFjdaPbWHaFAeZBe91gZ+mcvM1T+y7neYoijzfwV9VEsfMpdJhIzy6ql1V7qTZTXaW6VXWQ2PVYiyKsyx+rblGtpdpH9YbY7yI7DGcSSHV1Iu9Qsedd5DwKOSrxy53nWR2NXvBw3GBW7AjktOknb9/Unuc8T4w8tgxE0uP/H2GcrzrZtW9XzXFtXqpvxYqH/VRru74MPntN7kc0s14xiZOTR/FQlbqTd73YvU9PbV7C/VX3qv6R4vXt72j04gWxN7QXm0qr8uTGmSOTd5bzPHny8j6PyKDNQHvWSz7RDUTPua3uoUkg/WzkPM/M9O9zYtfZw/UR6XhEXzfIDH9J6+Uso2OHzuwNx1EjUI0fnzzudaV039NxzoRodoMBXhbNwLViFyW9be/8Q5J/ofM8Pm0y8PmHFz04/hHp7y1VK6Q1WUzkZenvbowTm4BPgn+j2LVPCn4Z6kZe/r1sF3iO6e3dhXA8++ZSzBfLwb1g0rjoxcGflPzrgp/xk0eq+yO1Y+XFdgM/Fy5Uv9eo3hW7d5kym0jgGvc4j4j9SOwamzi/LCMxeSeKrX1LU7sfHFP6Wc8T+4RF6ipiK7EL3iE2GB7eEPpuC36GdEx/TpvPp/acfEBiN7H0kteAU1xfWShouLaPsCnJuz+12btWoe7ksX6RRYAtWJ48PmhclP6OVFrzgMqOC5OLKQ5Ia1ervlA97Y4rgo/RFBORvcXO57p5TYJLkpejjIpyZat7CPY7VIlkhCyKml5vJNdkCfAsST4DOC30laHO5J0p9lszVLs8C/UD+8fJri9D9e1ritKcoFqo+lAsxJk80lc/LpXidIDn5TlGrHgh4h9NbU+ugKP4kMA2oojvpX2w4GDVl2J7UfaJVakzeUTWhOCxAX9KOn9v5jCxNDswGMzKod4DCo9PxQbe7w9PFas4mexBUWfyhgOBUOdb6rDwm9C6HC6dkZoheugr2h+NBuzPKKYGxVvRGASskWzYR4KJqt+jKVatsvbxKW9NhDW520s76lBZ5i8JIwHVIwUIqfJzsfVsTf1P3ZvE1sKiL0cDgbWPwS69wWwYgqzFpzwqzYaGhoaGhobAf3ypGELuY5DgAAAAAElFTkSuQmCC>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAAAaCAYAAAD/nKG4AAADuElEQVR4Xu2YaahNURTHl3lKMk/hmRUKJR9IZiIpMoRESpIPyFQKn5SIZIoMH0QRoRQR75WZDJHhg1BmyhiKxPpbe9+z7nrn3Hvfvdd16P7q3337v/cZ9j57r732IypS5F9gMeuwNWNKO9Yj9/tXwMPrq/Ip1lnWK1Yj5ceF6axb1iwELVgzjHeQ9dMpjoMFLlsjG2ax9rJeknT2CGtCUotktrKqW5O5S/EerMmsVtbMlCqs2axdrGGuDM6QdHojq5LzPDVZ743nuUnxHqyqrG3WTEdHktjygdXW1HnGkHT8Gauy8jED36my5grFe7AA3q+vNVPhO4VZFUUbCmJQJ+XfZ51QZU3UYA1ifWI9YW1n9Uqu/k0z1lXWG9Y+1mhWGauUkjeSXMH7LbFmKnDBdSq/xDSdKRis4c6r58pbfCND2GANZX1llZB0eibro6oH2NJfkMx4PGMlyX36u99RiZYBzVkPWGtI+tGD5PkIBXtIBj8M3G+nNaNoTXLBRFth8MsQau+8nq68yjcy2MFqwnrLOpRoISBHG6/KG0iu8yB2YibiF7Mw7KMeYy2ioPPY6dBusPM2B02T+E6ygWVEKeuSNQ0NSDqJh65XPmYYPOyeYdjBwpdHGYOsqeP8pq68zpU9iJEYrGrK00wiWdroi/6YYITzdihPg1zrtjWjwBc4ak3DapIHIpA3VL5fFvOUp9GDVdv9DdkYhV0J/gBXxvLERlLDlRe4+nR8Y90z3lqSa8cZ34OYe8OaUeym6ADt+UzywDnG7+b8Fcb36MHC7ECsQnmgbsTUdT7iDMDMuEjy1RHPEHfmurpU4B46fmLZPiX5yEhxwnhNsnFkxHySYBo1xRuTvAS+kKUlSR2WTRjXKBgs4PO1aYkWQheSd/B53VSSoFxRcG+dPPswscmVh6g6zw9Kv7KSOE9y02UkL9yHZAfCUjgeNAsFD0IKYOnOek5yXx28lzqvtytjdj5O1Ar4CFhSOF96nWTV0o0MiKvohwbvjmfhurGmzoP6KdZMB9Y0vibWMHaW5SS5VTp85y3wtDQjSYI9EuH9JKcFDXboO1T+Hhj8qONJV9ZC4/UjObIhjumNSYOZhbSjICAnwgPzBeLXQ9ZpkhDgQbBH/MpmeaYCB/6CcsAaOYBZhlmEVMCCc1w+PwxiqU+wCwamO4J0PihhfSFJVC1lrHPWzAGkRGEJ7h8H2zt2sXyBxBXJMg732P4R4O0ZM1uQxlygCp4J80kHktwo6gwWJ7AR4N9QRYoUKfJf8gvP+uMJ/6KLVgAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACsAAAAaCAYAAAAue6XIAAACIUlEQVR4Xu2WP0iVURjG3yIq+4uTS5a1VJDQktQk5GAQFBY5h4NIRDTYIFYogjUozYESREsRRTU0OBVBqUSQhkM1JaIkDTlJQz6P59zu8eF89zuB3yDcH/y493vec895L993z7lmVTYGt+EDDXPYDj/D81oomhm4U8OAkxp4GuFPeEwLRbEfXtLQsxVeNddQFsPwg4apdMHH5hb4C+fhmTUj1jIKN2to5c9+9++zOAT/wHNaqMQWeA3eh6fNNbAJtppb7GZ56D/43C1p6Gnwr4NWuVnyBH7SMMYRuAh/wX1SK9FpbsGPkvMOzEmm3LH8Zg9b/phV+I048LLkIU3mxtDdQf4NvgiuY6Q0S35rEIMTvddQaLZys/wFk73++l5pUAapzU5ooDSYmyjv4S49BrTGZyf8dZ+/ziK12TENlLfePJbNLXgjyM76rCPIYqQ2OwL3aBgyCZ9pGIGL8fncFmTcMZhfCbIYqc0+hDs0DOGAVxoKPF242AXJj/u8R3IltdmXGijdcNbimzrhVjYFr2sBHDDXxF0tCKnNvtEgxri5E4TPI5s+BQfgAnxqbh/O4jX8qmEADxXOwWYrzVNvaV9odcJ2+Mjcwtw3eWs5QR63LHsR5jF5SircjbLmWTeO2vos0g9/aFgEeSdYHryz07BXC0XQAg9q+B9cNPebqdNCUXyBbRomMASfa1g0/Nf0DtZqoQLcdfifZJcWqlTZ6KwAF6V2eBvbTBgAAAAASUVORK5CYII=>