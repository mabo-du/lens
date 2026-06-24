# **Architectural Resilience in Desktop Qualitative Data Analysis Software: Evaluating Electron, IPC Security, and Database Integration**

The development of Qualitative Data Analysis (QDA) software represents a uniquely demanding domain within software engineering. Researchers depend on these specialized tools to code, annotate, organize, and synthesize massive corpora of unstructured text, audio, video, and visual data. Historically, the open-source QDA ecosystem has suffered from a critical architectural vulnerability: tight coupling between the graphical user interface (GUI) framework and the underlying operating system. Legacy tools, most notably RQDA, were heavily bound to system-level GUI toolkits. This approach inevitably leads to catastrophic obsolescence when operating system updates or language runtime changes render the legacy toolkits non-functional, abandoning researchers and their vital data.  
To construct a resilient, offline-first, single-user desktop application capable of handling sensitive ethnographic research data, a completely decoupled web-technology stack is strictly required. By leveraging browser rendering engines for the UI and utilizing local databases for storage, developers can insulate the application from operating system deprecations. This exhaustive technical report evaluates the optimal architecture for a modern QDA application. It provides an in-depth analysis of framework selection between Electron and Tauri, secure Inter-Process Communication (IPC) channel design for SQLite isolation, strict process security models, local database integration strategies, cross-platform packaging pipelines, and contemporary boilerplate templates available for the 2026 development ecosystem.

## **Framework Selection: Electron vs. Tauri**

The selection of a foundational desktop framework dictates the long-term maintainability, resource consumption, hardware compatibility, and cross-platform consistency of the application. In recent years, Tauri has emerged as a formidable alternative to Electron. A rigorous evaluation is required to determine which framework poses the lower architectural risk for a solo open-source maintainer building a document-heavy, mathematically complex QDA tool over the 2025–2026 lifecycle.

### **Resource Utilization and Performance Characteristics**

Tauri and Electron operate on fundamentally divergent architectural philosophies. Tauri utilizes a Rust-based backend and relies entirely on the OS-native WebView for rendering (WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux). Electron, conversely, bundles a specific, statically compiled version of the Chromium rendering engine alongside a dedicated Node.js runtime environment. This architectural divergence results in drastically different resource footprints and execution profiles.1

| Performance Metric | Tauri Architecture | Electron Architecture |
| :---- | :---- | :---- |
| **Application Bundle Size** | 3 – 10 MB | 120 – 200 MB |
| **Idle Memory Overhead** | 40 – 80 MB | 150 – 400 MB |
| **Startup Time** | \< 200 milliseconds | 2 – 5 seconds |
| **Backend Language Paradigm** | Rust (Compiled, Memory-Safe) | JavaScript / TypeScript (Interpreted, JIT) |
| **Rendering Engine Ecosystem** | OS-Native Dynamic WebViews | Statically Bundled Chromium |

The application bundle size and active memory utilization of Tauri represent a substantial 20x to 50x reduction compared to Electron.1 For users running background applications on resource-constrained academic hardware or legacy laptops frequently found in field research, Tauri's efficiency is highly attractive.1 Furthermore, Tauri's Rust backend provides exceptional performance for CPU-bound tasks such as file parsing, large-scale tokenization, and text processing operations that are fundamental to qualitative data analysis.3 Rust's strict memory management and borrow checker also provide a layer of security against memory-leak vulnerabilities.1

### **Rendering Consistency and the WebView Fragmentation Problem**

While Tauri excels in raw performance metrics, its reliance on OS-native WebViews introduces severe cross-platform rendering inconsistencies that are particularly detrimental to QDA software. A Qualitative Data Analysis application is heavily reliant on complex, high-precision Document Object Model (DOM) manipulations. The core functionality—highlighting text, calculating overlay bounding boxes, applying qualitative codes, and rendering rich-text transcripts—demands exact precision in CSS styling, font rendering metrics, and text selection range calculations.  
Tauri's dependency on three distinct rendering engines (WebView2, WKWebView, and WebKitGTK) means that the rendering context is fragmented. A text selection offset algorithm that calculates perfectly on Windows (WebView2) may fail entirely on Linux because WebKitGTK renders fonts differently or lacks support for modern CSS subgrid features.3 For a solo developer, addressing these WebView inconsistencies requires establishing complex cross-platform testing matrices, virtual machines, and writing extensive platform-specific CSS or JavaScript polyfills.3 This fragmentation significantly increases the development burden.  
Conversely, Electron bundles a statically compiled version of Chromium. This guarantees absolute, pixel-perfect consistency across all target operating systems.3 An application tested on macOS will render identically on Windows and Linux, utilizing the exact same CSS properties and DOM calculation algorithms.1 For an Integrated Development Environment (IDE)-like application featuring advanced text editors, complex user interfaces, and intricate data visualizations, the cross-platform consistency provided by Electron vastly outweighs the penalty of a larger binary size.2

### **Native Module Compatibility: pdf.js and Multimedia Processing**

Qualitative research involves analyzing diverse file formats, including PDF documents, audio recordings, and video files. The ease of integrating specialized libraries for these formats is a critical framework consideration.  
Electron leverages the mature Node.js ecosystem, providing seamless access to thousands of pre-compiled native modules via npm. Integrating libraries like pdf.js for document rendering or utilizing Node.js wrappers around FFmpeg for local audio transcription and multimedia timestamping is straightforward, as Electron's main process operates as a standard Node environment.1  
Tauri, however, lacks direct Node.js access in its backend. While its frontend can execute JavaScript libraries, any operation requiring heavy file system access or native binary execution must be written in Rust or bridged via custom Tauri plugins.1 If an open-source Rust equivalent for a specific multimedia processing library does not exist, the maintainer must write the Foreign Function Interface (FFI) bindings themselves.1

### **Maintainer Risk and Ecosystem Maturity**

Electron possesses over a decade of production maturity, serving as the foundation for mission-critical applications like Visual Studio Code, Slack, and Figma.1 Its JavaScript ecosystem allows developers to leverage existing rich-text editor components and Node.js native modules without requiring a paradigm shift to Rust.1  
For a solo open-source maintainer in the 2025–2026 lifecycle, minimizing maintenance overhead and maximizing development velocity is paramount. Debugging platform-specific WebView rendering bugs in Tauri diverts critical time away from feature development and data analysis algorithms.3 Therefore, despite the undeniable resource efficiency of Tauri, Electron represents the lower architectural risk for a document-heavy, visually complex QDA application, allowing the maintainer to utilize a single language (TypeScript) across the entire stack.3

## **Local Database Integration Strategies in the Main Process**

An offline-first QDA application requires a robust, local relational database to persist the complex web of research data. Qualitative research involves highly relational data structures: transcripts linking to annotations, annotations linking to qualitative codes, and codes organized into hierarchical trees. The database must operate with extremely low latency to ensure the UI remains highly responsive during rapid, repetitive coding workflows.  
Integrating SQLite into an Electron Main process presents several paths, each with distinct trade-offs regarding performance, packaging complexity, and compilation requirements.

### **Synchronous vs. Asynchronous Database Drivers**

The initial decision involves choosing between synchronous and asynchronous database execution models.

1. **The sqlite3 Asynchronous Library**: Historically, early Node.js applications utilized the sqlite3 npm package. This library operates asynchronously, utilizing callback functions to prevent blocking the Node.js event loop.6 While non-blocking execution is critical for high-concurrency web servers, it introduces unnecessary latency and promise-chaining complexity in a single-user desktop application. Furthermore, the asynchronous nature makes sequential data processing and complex transaction management significantly more difficult to reason about.  
2. **The better-sqlite3 Synchronous Library**: The better-sqlite3 package is widely considered the industry standard for high-performance SQLite access in Node.js and Electron.8 It operates entirely synchronously. Because an Electron application is single-user, blocking the Main process event loop for a fraction of a millisecond to execute a local SQL query has no discernible impact on UI responsiveness, as the UI runs in a completely separate Renderer process.9 better-sqlite3 is highly optimized, supports worker threads, and offers immense performance advantages over the asynchronous sqlite3 library.9

### **The Compilation Penalty and electron-rebuild**

While better-sqlite3 offers superior performance, it relies on native C++ bindings to interact with the underlying SQLite C engine.12 This introduces a significant architectural challenge: the native module must be compiled against the specific version of the V8 JavaScript engine bundled inside Electron, which frequently differs from the Node.js version installed on the developer's host machine.13  
This necessitates the use of electron-rebuild (or @electron/rebuild), a tool that downloads the Electron C++ headers and recompiles all native modules.14 The rebuilding process is notorious for causing cross-platform packaging failures. Developers frequently encounter NODE\_MODULE\_VERSION mismatch errors, node-gyp configuration failures on Windows (requiring specific Microsoft Visual Studio C++ build tools), and complex cross-compilation errors when building for ARM64/Apple Silicon architectures from x64 CI runners.12 For a solo maintainer, managing native dependency compilation across three operating systems represents a high continuous maintenance burden.16

### **Modern Alternatives: node:sqlite and PGlite**

To circumvent the native module compilation penalty, the 2026 ecosystem provides two advanced alternatives.

| Database Engine | Architecture | Native Rebuild Required? | Advanced Capabilities |
| :---- | :---- | :---- | :---- |
| **better-sqlite3** | Native C++ Node.js Addon | Yes (High Friction) | Synchronous, High Performance |
| **sqlite3** | Native C++ Node.js Addon | Yes (High Friction) | Asynchronous, Legacy Support |
| **node:sqlite** | Built-in Node.js API | No (Zero Friction) | Synchronous, Zero Dependencies |
| **@Electric-SQL/pglite** | WebAssembly (WASM) | No (Zero Friction) | Asynchronous, pgvector, Extensions |

Recent iterations of Node.js (v22+) introduced a built-in, synchronous SQLite implementation accessible via the node:sqlite module.17 By utilizing the native Node.js implementation, developers completely bypass the node-gyp compilation pipeline. This entirely eliminates the necessity for electron-rebuild, vastly streamlining the cross-platform build process and eliminating NODE\_MODULE\_VERSION mismatches.10 For standard relational queries, node:sqlite provides sufficient performance without the packaging fragility.  
Alternatively, PGlite is a WebAssembly (WASM) build of PostgreSQL that runs embedded entirely within the JavaScript runtime.19 At approximately 3MB gzipped, it requires no Linux virtual machine and persists data directly to the local file system in Node.js.19 Because it executes in WASM, it requires absolutely no native recompilation.20 While it introduces slightly more latency than bare SQLite for simple CRUD operations, it provides dynamic extension loading—most notably pgvector.21 If the QDA application intends to integrate local AI capabilities (e.g., semantic search across qualitative codes using text embeddings), PGlite offers a profound advantage by supporting vector operations natively in the embedded environment.21  
For a solo maintainer prioritizing low packaging friction and immediate deployment reliability, node:sqlite is the optimal choice for a standard SQLite backend. If advanced vector mathematics or strict PostgreSQL compliance is required for future features, PGlite provides an enterprise-grade engine without the native-module compilation penalties.11

## **IPC Channel Design for SQLite Isolation**

Electron's process model is bifurcated. The Main process possesses full access to the underlying operating system and Node.js APIs, while the Renderer processes are highly restricted, sandboxed environments responsible solely for displaying the user interface. Direct access to the local file system or SQLite database from the Renderer process is a severe security vulnerability. Therefore, the database must be tightly isolated within the Main process, with the Renderer querying data exclusively via Inter-Process Communication (IPC) channels.25  
Designing the IPC architecture requires careful consideration of data contracts, type safety, and security boundaries.

### **Evaluating Channel Design Topologies**

When designing IPC boundaries for database interactions, developers typically evaluate three structural topologies:

1. **The Generic Query Bus (Anti-Pattern)**: In this flawed architecture, the developer creates a single IPC channel (e.g., execute-sql) and allows the Renderer to transmit raw SQL query strings directly to the Main process for execution. This essentially introduces a local SQL injection vulnerability. If the Renderer is compromised via a Cross-Site Scripting (XSS) attack—such as rendering an improperly sanitized interview transcript containing a malicious script tag—the attacker can execute arbitrary SQL to read, drop tables, or maliciously modify the entire research database.26 This pattern must be strictly avoided.  
2. **One Channel Per Table**: This topology creates distinct channels for table-level CRUD operations (e.g., get-transcripts, insert-transcript, get-codes). While safer than a generic bus, this approach quickly becomes unwieldy. Qualitative data queries often require complex SQL JOIN statements across multiple tables (e.g., fetching a transcript alongside its linked annotations and nested codes). Mapping IPC channels strictly to single tables forces the Renderer to make multiple IPC requests and perform data joining in the UI thread, severely degrading performance.  
3. **One Channel Per Use-Case (The RPC Pattern)**: The optimal approach defines IPC channels based on specific UI data requirements (e.g., load-transcript-workspace, apply-code-to-selection). This encapsulates the complex SQL JOIN logic securely within the Main process, ensuring the Renderer only receives the exact data payload required for rendering.27

### **The tRPC Pattern for End-to-End Typed IPC**

To implement the use-case topology safely and maintain strict TypeScript definitions across the process boundary, the current architectural best practice relies on Remote Procedure Call (RPC) frameworks—specifically tRPC adapted for Electron (electron-trpc).4  
Using electron-trpc, the application defines a strictly typed router in the Main process. Every procedure (query or mutation) is protected by a runtime schema validator, leveraging libraries such as Zod. This architectural pattern guarantees that the Renderer can only request pre-defined operations, and the input payloads conform exactly to expected types.4 It catches developer-time type errors via TypeScript and entirely eliminates the exposed attack surface of malformed or malicious IPC requests.4  
**Reference Implementation Pattern:**

1. **Main Process (Router Definition and Error Handling):**  
   TypeScript  
   import { z } from 'zod';  
   import { router, publicProcedure } from './trpc';  
   import { db } from './database'; // Instance of node:sqlite or better-sqlite3  
   import { TRPCError } from '@trpc/server';

   export const appRouter \= router({  
     getTranscriptWorkspace: publicProcedure  
      .input(z.object({ transcriptId: z.string().uuid() }))  
      .query(({ input }) \=\> {  
         try {  
           // Execution isolated entirely in the Main Process  
           const transcript \= db.prepare('SELECT \* FROM transcripts WHERE id \=?').get(input.transcriptId);  
           const annotations \= db.prepare('SELECT \* FROM annotations WHERE transcript\_id \=?').all(input.transcriptId);  
           return { transcript, annotations };  
         } catch (error) {  
           // Mapping SQLite errors to standardized tRPC errors to surface to the UI  
           throw new TRPCError({  
             code: 'INTERNAL\_SERVER\_ERROR',  
             message: 'Failed to retrieve workspace data.',  
             cause: error,  
           });  
         }  
       }),

     addAnnotation: publicProcedure  
      .input(z.object({   
           transcriptId: z.string().uuid(),  
           codeId: z.string().uuid(),  
           textRange: z.string(),  
           startIndex: z.number().int().min(0),  
           endIndex: z.number().int().min(0)  
       }))  
      .mutation(({ input }) \=\> {  
         try {  
           const stmt \= db.prepare('INSERT INTO annotations (transcript\_id, code\_id, text\_range, start\_index, end\_index) VALUES (?,?,?,?,?)');  
           const result \= stmt.run(input.transcriptId, input.codeId, input.textRange, input.startIndex, input.endIndex);  
           return { success: true, insertedId: result.lastInsertRowid };  
         } catch (error) {  
            // Handle SQLite Constraint Violations (e.g., UNIQUE constraint on identical annotations)  
            if (error.code \=== 'SQLITE\_CONSTRAINT\_UNIQUE') {  
                throw new TRPCError({  
                    code: 'CONFLICT',  
                    message: 'An identical annotation already exists at this location.',  
                });  
            }  
            throw new TRPCError({ code: 'INTERNAL\_SERVER\_ERROR', message: 'Database mutation failed.' });  
         }  
       })  
   });

   export type AppRouter \= typeof appRouter;

2. **Preload Script (Context Bridge Exposure):**  
   TypeScript  
   import { exposeElectronTRPC } from 'electron-trpc/main';  
   process.once('loaded', async () \=\> {  
     // Securely funnels tRPC requests without exposing the raw ipcRenderer  
     exposeElectronTRPC();  
   });

3. **Renderer Process (Type-Safe Invocation):**  
   TypeScript  
   import { createTRPCReact } from '@trpc/react-query';  
   import type { AppRouter } from '../../main/router';

   // The Renderer infers all types dynamically from the Main process AppRouter  
   export const trpc \= createTRPCReact\<AppRouter\>();

   // Usage inside a React Component  
   const TranscriptView \= ({ transcriptId }) \=\> {  
       // Full autocomplete and type-safety on inputs and return data  
       const { data, error, isLoading } \= trpc.getTranscriptWorkspace.useQuery({ transcriptId });

       if (error) {  
           // Surfacing the strongly-typed database error to the UI  
           return \<div className\="error-banner"\>Error: {error.message}\</div\>;  
       }

       if (isLoading) return \<Spinner /\>;

       return \<Workspace transcript\={data.transcript} annotations\={data.annotations} /\>;  
   };

By bridging tRPC directly over Electron's IPC mechanism, the application achieves end-to-end type safety without managing HTTP servers or exposing localhost ports.31 Changes to the database schema or Main process queries instantly trigger TypeScript compilation errors in the React frontend if the data contract is violated.4 Furthermore, any errors generated by the SQLite database layer (e.g., foreign key violations, unique constraints) are caught by the tRPC router and seamlessly propagated back to the React UI as standardized TRPCError objects, allowing for elegant error boundaries in the frontend visualization.

## **Security Architecture for Sensitive Research Data**

Qualitative Data Analysis software frequently handles highly sensitive information, including anonymized interview transcripts, ethnographic field notes, and proprietary corporate documents. Ensuring that the application is fortified against both internal vulnerabilities and external attack vectors is a non-negotiable requirement.  
Because Electron combines the Chromium rendering engine and Node.js, an insecurely configured Renderer process allows malicious JavaScript to bypass the browser sandbox and interact directly with the user's file system.26 A comprehensive security posture requires the implementation of multiple defense-in-depth mechanisms, strictly adhering to the official Electron security guidelines.26

### **Context Isolation and Node Integration**

The most critical security configurations occur during the instantiation of the BrowserWindow within the Main process.

1. **Node Integration**: The nodeIntegration flag must explicitly be set to false.26 Permitting Node.js integration inside the Renderer allows any script running in the window to invoke powerful primitives like require('fs') or require('child\_process').26 If a Cross-Site Scripting (XSS) vulnerability occurs—for instance, an application rendering an improperly sanitized interview transcript containing a malicious script tag—disabled Node integration prevents the exploit from escalating into a Remote Code Execution (RCE) event on the host operating system.26  
2. **Context Isolation**: Context Isolation (contextIsolation: true) ensures that the preload.js script and the Renderer's web execution environment operate in two distinct, isolated V8 JavaScript contexts.26 Without context isolation, a malicious script in the Renderer could manipulate the global JavaScript prototype chain (e.g., overriding Array.prototype.push or Promise.resolve), thereby hijacking the execution flow of the highly privileged preload script.26 Context isolation guarantees that the window object accessed by the preload script is fundamentally segregated from the window object accessed by the React frontend, mitigating prototype pollution attacks.34

### **The Preload Script Pattern**

To facilitate necessary communication between the restricted Renderer and the privileged Main process without compromising security, Electron provides the contextBridge API.26 The preload script executes prior to the web content loading and possesses restricted access to polyfilled Node.js primitives and IPC APIs. The contextBridge selectively funnels specific, hardcoded functions to the Renderer's global scope.35  
A common critical security failure is exposing the entirety of the ipcRenderer directly over the context bridge:

JavaScript  
// DANGEROUS ANTI-PATTERN \- DO NOT USE  
contextBridge.exposeInMainWorld('api', {  
    send: ipcRenderer.send,  
    invoke: ipcRenderer.invoke  
});

This defeats the purpose of the bridge, as compromised web content can then transmit arbitrary payloads to any registered IPC channel.26 The best practice is to expose only specific, tightly scoped functions (or utilize the aforementioned electron-trpc handler, which secures the invocation layer automatically).26

### **Content Security Policy (CSP) Headers**

A robust Content Security Policy (CSP) acts as the final defense layer against XSS injections. For local-first Electron applications, CSP prevents the execution of unauthorized inline scripts, disables remote eval(), and prevents the application from loading unauthorized external resources.26  
CSP headers should be enforced natively at the network intercept layer within the Main process using webRequest.onHeadersReceived, rather than relying solely on HTML meta tags, to ensure the policy cannot be bypassed by navigating to a new local file.26

JavaScript  
const { app, session } \= require('electron');

app.whenReady().then(() \=\> {  
  session.defaultSession.webRequest.onHeadersReceived((details, callback) \=\> {  
    callback({  
      responseHeaders: {  
       ...details.responseHeaders,  
        // Highly restrictive policy: self-only, no unsafe inline execution, no remote eval  
        'Content-Security-Policy': \["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; connect-src 'self'"\]  
      }  
    });  
  });  
});

### **File System Access and Process Sandboxing**

Because Electron applications often interact with the local file system (e.g., importing PDFs or audio files), special precautions must be taken to prevent directory traversal attacks or unauthorized file access.

1. **Avoid the file:// Protocol**: Serving local HTML files and assets using the default file:// protocol is discouraged, as it receives elevated security privileges and behaves unpredictably with modern routing libraries.26 Modern Electron architectures utilize custom protocol handlers (e.g., app://) to serve local files, granting the application tighter control over origin policies and routing access.26  
2. **Enable Process Sandboxing**: Process sandboxing leverages underlying operating system security features (such as namespaces on Linux or App Sandbox on macOS) to restrict what the Renderer process can achieve at the kernel level.26 A sandboxed Renderer is stripped of all OS capabilities and is strictly confined to executing CPU cycles and memory allocations.26 Access to the file system or network interfaces requires explicit delegation to the Main process via IPC. Developers must ensure that the sandbox: true configuration remains active.26

## **Cross-Platform Packaging via electron-builder**

Deploying a desktop application across Windows, macOS, and Linux requires a highly orchestrated, automated packaging pipeline. electron-builder remains the industry standard for this complex task, offering comprehensive support for generating platform-specific distribution artifacts.37  
To produce distributable installers across the three major operating systems, the minimum required artifacts include:

* **Windows:** NSIS (.exe) installer or MSI packages.38 NSIS provides script-based customization and per-user installation modes, while MSI is frequently required for enterprise deployments managed via Group Policy Object (GPO).38  
* **macOS:** DMG (.dmg) disk images for initial user installation, and zipped application bundles (.zip) strictly required for background auto-updates.38  
* **Linux:** AppImage (.AppImage) for standalone execution without dependency issues, and Debian (.deb) packages for traditional package manager installations on Ubuntu/Debian distributions.38

### **Managing ASAR Archives and Native SQLite Modules**

Electron applications wrap their source code and node modules into an ASAR (Atom Shell Archive Format) file. This read-only, tar-like archive provides minor file-system performance benefits and conceals raw source code.40 However, a critical packaging failure occurs if native Node modules compiled in C/C++ (such as better-sqlite3 or sqlite3) are packed inside the ASAR archive. The operating system cannot directly execute or load native .node binaries from within an archive.41  
If a native module is packaged inside the ASAR, the application will fatally crash upon initialization with the exception: Error: Module did not self-register or an ENOENT error.41 To mitigate this, electron-builder must be explicitly configured to unpack native modules into a separate app.asar.unpacked directory using the asarUnpack directive.42 If using the native node:sqlite API, this step is entirely bypassed, further highlighting its architectural superiority.18  
**Minimum Viable electron-builder Configuration:**

YAML  
appId: org.research.qda-app  
productName: QDA Analysis Tool  
directories:  
  output: release/build  
\# Essential for Native C++ Modules (e.g., better-sqlite3)  
build:  
  asar: true  
  asarUnpack:  
    \- "\*\*/\*.node"  
    \- "node\_modules/better-sqlite3/\*\*"  
win:  
  target:  
    \- target: nsis  
      arch: \[x64, arm64\]  
    \- target: msi  
      arch: \[x64\]  
mac:  
  target:  
    \- target: dmg \# For user drag-and-drop  
      arch: \[x64, arm64\]  
    \- target: zip \# REQUIRED for background auto-updates  
      arch: \[x64, arm64\]  
  hardenedRuntime: true  
  entitlements: build/entitlements.mac.plist  
linux:  
  target:  
    \- target: AppImage  
    \- target: deb

### **macOS Notarization and Gatekeeper Compliance**

Distribution on macOS represents the most complex packaging challenge due to Apple's strict Gatekeeper security requirements. To execute on macOS 10.15 (Catalina) and above without throwing severe security warnings or being entirely blocked, the application must be cryptographically signed using a valid "Developer ID Application" certificate and subsequently transmitted to Apple's servers for Notarization.41  
Notarization enforces several unyielding rules:

1. **Hardened Runtime**: The application must be compiled with the Hardened Runtime enabled (hardenedRuntime: true in the mac configuration block).41 This restricts the app's capability to execute self-modifying code or load unauthorized dynamic libraries, increasing security.41  
2. **Entitlements Exemption**: Because Electron relies heavily on the V8 JavaScript engine—which inherently utilizes Just-In-Time (JIT) compilation to transform JavaScript into machine code at runtime—the Hardened Runtime will immediately crash the application upon launch unless explicitly granted an exemption.41 An entitlements property list file (entitlements.mac.plist) must be supplied to electron-builder.41

**Required macOS Entitlements File (build/entitlements.mac.plist):**

XML  
\<?xml version="1.0" encoding="UTF-8"?\>  
\<\!DOCTYPE **plist** **PUBLIC** "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"\>  
\<plist version\="1.0"\>  
\<dict\>  
  \<key\>com.apple.security.cs.allow-jit\</key\>  
  \<true/\>  
  \<key\>com.apple.security.cs.allow-unsigned-executable-memory\</key\>  
  \<true/\>  
\</dict\>  
\</plist\>

Failure to include the allow-jit entitlement will result in silent runtime crashes, "white screen of death" initializations, or immediate Notarization rejections from Apple.41

### **Over-The-Air (OTA) Auto-Updates via GitHub Releases**

For an open-source QDA tool operating with zero commercial budget for dedicated Content Delivery Networks (CDNs), GitHub Releases provides the optimal hosting environment for distribution and Over-The-Air (OTA) auto-updates.37  
The electron-updater package integrates seamlessly with electron-builder artifacts.37 During the build process, electron-builder generates .yml manifest files (e.g., latest.yml for Windows, latest-mac.yml for macOS) alongside the compiled binaries. These manifests contain versioning data and SHA-512 cryptographic hashes utilized by the application to securely detect and verify incoming updates.39  
To configure the updater to track a GitHub repository, the publish directive must be specified within the electron-builder configuration.48 During a GitHub Actions Continuous Integration (CI) run, executing npx electron-builder \--publish always utilizes a provided GH\_TOKEN secret to automatically upload the generated installers and .yml manifests to the repository's Releases page.41  
**macOS Failure Mode Consideration:** A notable failure mode in auto-update configuration pertains to macOS targets. Developers frequently configure electron-builder to solely produce a .dmg file for Apple architectures.50 However, electron-updater is fundamentally incapable of utilizing a .dmg artifact for background differential updates, as .dmg is an install-time, interactive format.39 To enable automatic, silent background updates on macOS, the build target must include the .zip format.39 The updater queries the latest-mac.yml file, downloads the .zip archive, silently extracts the updated .app bundle, and replaces the currently running instance upon application restart.39

## **Contemporary Application Architecture Templates**

Constructing the boilerplate infrastructure to unify Electron, React, TypeScript, Vite, SQLite, tRPC, and cross-platform GitHub Actions CI pipelines from scratch is highly laborious. Several well-maintained, open-source scaffolding templates and starter kits embody the architectural best practices required for a 2026-era application.51 Utilizing a template significantly reduces initial development friction and ensures best-practice implementation of IPC boundaries and packaging configurations.

| Template / Repository | Primary Focus | Tech Stack | Stars |
| :---- | :---- | :---- | :---- |
| **iamshiv4m/create-era-next** | Developer Experience & Type-Safety | Electron, Vite 7, React 19, TS 5.9, tRPC, Tailwind 4, SQLite | N/A |
| **islem-boudja/electron-trpc-drizzle-starter** | Database Orchestration & RPC | Electron, tRPC, Drizzle ORM, Vite, Tailwind | N/A |
| **kethakav/electron-vite-react-boilerplate** | UI Framework & Auto-Updates | Electron, Vite, React 18, TS, DaisyUI | 9 |
| **wds4/electron-react-boilerplate-sqlite3** | Basic SQLite IPC Education | Electron, Webpack, React, sqlite3 | N/A |

### **1\. create-era-next (iamshiv4m)**

* **GitHub Repository:** https://github.com/iamshiv4m/create-era-next  
* **Status:** Actively maintained as of early 2026\.52  
* **Architecture:** This modern template replaces legacy Webpack configurations with Vite (electron-vite), reducing development server startup times to under one second.52 It natively incorporates compile-time safe typed IPC patterns, reducing the boilerplate required for defining communication channels.52 The template ships with pre-configured GitHub Actions matrices for generating Windows, macOS, and Linux releases, alongside fully configured electron-updater hooks.52 It provides an excellent, highly modern foundation for a complex React application.

### **2\. electron-trpc-drizzle-starter (islem-boudja)**

* **GitHub Repository:** https://github.com/islem-boudja/electron-trpc-drizzle-starter  
* **Status:** Maintained, targets modern database patterns.32  
* **Architecture:** This repository provides a robust blueprint for applications featuring complex relational data models. By unifying tRPC across the Electron IPC boundary with Drizzle ORM, it offers end-to-end type inference from the database schema directly to the React views.32 While the starter defaults to a Dockerized PostgreSQL environment for development, Drizzle ORM can easily be refactored to consume a local node:sqlite instance, providing the ultimate architecture for rigorous, error-free database manipulation in a QDA tool.32

### **3\. electron-vite-react-boilerplate (kethakav)**

* **GitHub Repository:** https://github.com/kethakav/electron-vite-react-boilerplate  
* **Status:** 9 Stars, active updates.53  
* **Architecture:** Specifically engineered to solve the documentation gaps and implementation headaches associated with electron-updater and Windows NSIS packaging configurations.53 It provides out-of-the-box UI component libraries (DaisyUI) and hot module replacement (HMR), making it highly suitable for applications requiring complex, immediately stylized frontends without spending days configuring underlying build tools.53

### **4\. electron-react-boilerplate-sqlite3 (wds4)**

* **GitHub Repository:** https://github.com/wds4/electron-react-boilerplate-sqlite3  
* **Status:** Based on a December 2022 fork of ERB, educational focus.8  
* **Architecture:** This repository is a fork of the historically popular electron-react-boilerplate (ERB), augmented specifically to demonstrate Main-Renderer IPC interactions with a persistent SQLite instance.8 While Webpack relies on an older paradigm compared to Vite, this repository serves as an excellent, simplified pedagogical reference for developers seeking to understand raw IPC listener configuration and extracting database access completely from the frontend environment.8

## **Conclusion**

The construction of an open-source Desktop Qualitative Data Analysis tool to rival proprietary enterprise software demands a highly stable, meticulously secured, and decoupled software stack. Based on the aggregated technical constraints, security parameters, and ecosystem trajectories leading into 2026, the optimal architecture requires several specific commitments.  
First, Electron remains fundamentally superior to Tauri for this specific document-heavy use case. The extreme precision required to render qualitative coding highlights across deeply nested text fragments, combined with the need to seamlessly integrate multimedia parsing libraries like FFmpeg and pdf.js via Node.js native modules, mandates the uniform rendering engine and robust JavaScript backend that Electron guarantees.1 The cost of increased memory utilization is an acceptable tradeoff to avoid the catastrophic maintenance overhead of debugging OS-specific WebView inconsistencies.  
Second, the data layer should embrace the native node:sqlite implementation or the WASM-based PGlite database.18 By utilizing these modern engines, the developer entirely bypasses the fragile node-gyp native module compilation headaches associated with better-sqlite3, ensuring smooth cross-compilation for Apple Silicon and Windows environments.18  
Third, the communication boundary between the restricted Renderer and the privileged Main process must be constructed using electron-trpc. The use of Zod schemas and strictly defined tRPC mutations prevents IPC manipulation, guarantees data contract consistency, and safely propagates database constraints up to the React interface without exposing a generic SQL query bus vulnerability.4  
Finally, distribution should leverage electron-builder hooked into a GitHub Actions CI pipeline, securely injecting Base64-encoded certificates to satisfy macOS Gatekeeper Notarization (with Hardened Runtime entitlements) and Windows Authenticode requirements.41 By configuring electron-updater with GitHub Releases, the application achieves a zero-cost, highly resilient Over-The-Air background update pipeline.37 This holistic architectural configuration ensures longevity, absolute decoupling from OS-specific legacy GUI toolkits, and an impenetrable environment for handling highly sensitive qualitative research data.

#### **Works cited**

1. Tauri vs Electron 2026: Tauri Wins: Here's the Real Data \- Rustify, accessed June 15, 2026, [https://rustify.rs/articles/rust-tauri-vs-electron-2026](https://rustify.rs/articles/rust-tauri-vs-electron-2026)  
2. How do you explain the Electron vs Tauri tradeoff to users without sounding defensive?, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1s0afeg/how\_do\_you\_explain\_the\_electron\_vs\_tauri\_tradeoff/](https://www.reddit.com/r/electronjs/comments/1s0afeg/how_do_you_explain_the_electron_vs_tauri_tradeoff/)  
3. Cross-Platform Desktop Wars: Electron vs Tauri: How do you explain ..., accessed June 15, 2026, [https://dev.to/nikolas\_dimitroulakis\_d23/cross-platform-desktop-wars-electron-vs-tauri-how-do-you-explain-the-tradeoffs-to-users-2948](https://dev.to/nikolas_dimitroulakis_d23/cross-platform-desktop-wars-electron-vs-tauri-how-do-you-explain-the-tradeoffs-to-users-2948)  
4. Electron Desktop App Development Guide for Business in 2026 \- Fora Soft, accessed June 15, 2026, [https://www.forasoft.com/blog/article/electron-desktop-app-development-guide-for-business](https://www.forasoft.com/blog/article/electron-desktop-app-development-guide-for-business)  
5. Tauri vs Electron: The Complete Developer's Guide (2026) \- NishikantaRay, accessed June 15, 2026, [https://blog.nishikanta.in/tauri-vs-electron-the-complete-developers-guide-2026](https://blog.nishikanta.in/tauri-vs-electron-the-complete-developers-guide-2026)  
6. Building Cross Platform Desktop Apps with Electron and Sqlite3 | by Chandima Ranaweera, accessed June 15, 2026, [https://medium.com/@chan4lk/building-desktop-apps-with-electron-and-sqlite3-855480a9ebab](https://medium.com/@chan4lk/building-desktop-apps-with-electron-and-sqlite3-855480a9ebab)  
7. How to use sqlite3 module with electron? \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/32504307/how-to-use-sqlite3-module-with-electron](https://stackoverflow.com/questions/32504307/how-to-use-sqlite3-module-with-electron)  
8. wds4/electron-react-boilerplate-sqlite3: electron-react-boilerplate augmented by sqlite3, accessible by the renderer process, package-ready \- GitHub, accessed June 15, 2026, [https://github.com/wds4/electron-react-boilerplate-sqlite3](https://github.com/wds4/electron-react-boilerplate-sqlite3)  
9. Building a cross-platform AI desktop assistant with Electron and LLMs., accessed June 15, 2026, [https://emasterlabs.com/cross-platform-ai-desktop-assistant-with-electron-and-llms/](https://emasterlabs.com/cross-platform-ai-desktop-assistant-with-electron-and-llms/)  
10. I made a complete Electron \+ SQLite tutorial (from scratch to installer) and got schooled on Murphy's Law : r/electronjs \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1p39pr3/i\_made\_a\_complete\_electron\_sqlite\_tutorial\_from/](https://www.reddit.com/r/electronjs/comments/1p39pr3/i_made_a_complete_electron_sqlite_tutorial_from/)  
11. MikroORM 7: Unchained, accessed June 15, 2026, [https://mikro-orm.io/blog/mikro-orm-7-released](https://mikro-orm.io/blog/mikro-orm-7-released)  
12. Electron JS, Vite & Better SQLite: Complete Tutorial Build a Desktop App From Scratch to Installer \- YouTube, accessed June 15, 2026, [https://www.youtube.com/watch?v=GQvDNRBe4IU](https://www.youtube.com/watch?v=GQvDNRBe4IU)  
13. Help me use Electron\! · Issue \#126 · WiseLibs/better-sqlite3 \- GitHub, accessed June 15, 2026, [https://github.com/WiseLibs/better-sqlite3/issues/126](https://github.com/WiseLibs/better-sqlite3/issues/126)  
14. How to use better-sqlite3 with electron-react-boilerplate \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/69930475/how-to-use-better-sqlite3-with-electron-react-boilerplate](https://stackoverflow.com/questions/69930475/how-to-use-better-sqlite3-with-electron-react-boilerplate)  
15. Sqlite or Better-Sqlite3 Help With Electron and React : r/electronjs \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/v8p8wx/sqlite\_or\_bettersqlite3\_help\_with\_electron\_and/](https://www.reddit.com/r/electronjs/comments/v8p8wx/sqlite_or_bettersqlite3_help_with_electron_and/)  
16. Help adding local database : r/electronjs \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1h6j7ki/help\_adding\_local\_database/](https://www.reddit.com/r/electronjs/comments/1h6j7ki/help_adding_local_database/)  
17. SQLite | Node.js v26.3.0 Documentation, accessed June 15, 2026, [https://nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)  
18. Using the built-in SQLite module in Node.js \- LogRocket Blog, accessed June 15, 2026, [https://blog.logrocket.com/using-built-in-sqlite-module-node-js/](https://blog.logrocket.com/using-built-in-sqlite-module-node-js/)  
19. electric-sql/pglite: Embeddable Postgres with real-time, reactive bindings. \- GitHub, accessed June 15, 2026, [https://github.com/electric-sql/pglite](https://github.com/electric-sql/pglite)  
20. Drizzle \<\> PGlite, accessed June 15, 2026, [https://orm.drizzle.team/docs/connect-pglite](https://orm.drizzle.team/docs/connect-pglite)  
21. PGlite, accessed June 15, 2026, [https://pglite.dev/](https://pglite.dev/)  
22. Benchmarks | PGlite, accessed June 15, 2026, [https://pglite.dev/benchmarks](https://pglite.dev/benchmarks)  
23. Google Chrome feature makes JavaScript 10X faster, GSAP is now free, UNKNOWN JavaScript hack, and more \- DEV Community, accessed June 15, 2026, [https://dev.to/thisweekinjavascript/google-chrome-feature-makes-javascript-10x-faster-gsap-is-now-free-unknown-javascript-hack-and-c8e](https://dev.to/thisweekinjavascript/google-chrome-feature-makes-javascript-10x-faster-gsap-is-now-free-unknown-javascript-hack-and-c8e)  
24. MikroORM 7.1: Loaded, accessed June 15, 2026, [https://mikro-orm.io/blog/mikro-orm-7-1-released](https://mikro-orm.io/blog/mikro-orm-7-1-released)  
25. Inter-Process Communication \- Electron, accessed June 15, 2026, [https://electronjs.org/docs/latest/tutorial/ipc](https://electronjs.org/docs/latest/tutorial/ipc)  
26. Security | Electron, accessed June 15, 2026, [https://electronjs.org/docs/latest/tutorial/security](https://electronjs.org/docs/latest/tutorial/security)  
27. Use Case based architecture for Electron IPC : r/electronjs \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1q9djye/use\_case\_based\_architecture\_for\_electron\_ipc/](https://www.reddit.com/r/electronjs/comments/1q9djye/use_case_based_architecture_for_electron_ipc/)  
28. StreamUI/ssr-electron \- htmx, Alpine.js, Datastar, and SSE \- GitHub, accessed June 15, 2026, [https://github.com/StreamUI/ssr-electron](https://github.com/StreamUI/ssr-electron)  
29. jsonnull/electron-trpc: Build type-safe Electron inter-process communication using tRPC, accessed June 15, 2026, [https://github.com/jsonnull/electron-trpc](https://github.com/jsonnull/electron-trpc)  
30. electron-best-practices — AI agent skill | explainx.ai, accessed June 15, 2026, [https://explainx.ai/skills/jwynia/agent-skills/electron-best-practices](https://explainx.ai/skills/jwynia/agent-skills/electron-best-practices)  
31. makp0/electron-trpc-experimental \- GitHub, accessed June 15, 2026, [https://github.com/makp0/electron-trpc-experimental](https://github.com/makp0/electron-trpc-experimental)  
32. islem-boudja/electron-trpc-drizzle-starter \- GitHub, accessed June 15, 2026, [https://github.com/islem-boudja/electron-trpc-drizzle-starter](https://github.com/islem-boudja/electron-trpc-drizzle-starter)  
33. tRPC for both Electron IPC and HTTP API routes at the same time \#4675 \- GitHub, accessed June 15, 2026, [https://github.com/trpc/trpc/discussions/4675](https://github.com/trpc/trpc/discussions/4675)  
34. Context Isolation \- Electron, accessed June 15, 2026, [https://electronjs.org/docs/latest/tutorial/context-isolation](https://electronjs.org/docs/latest/tutorial/context-isolation)  
35. contextBridge \- Electron, accessed June 15, 2026, [https://electronjs.org/docs/latest/api/context-bridge](https://electronjs.org/docs/latest/api/context-bridge)  
36. protocol | Electron, accessed June 15, 2026, [https://electronjs.org/docs/latest/api/protocol](https://electronjs.org/docs/latest/api/protocol)  
37. electron-builder, accessed June 15, 2026, [https://www.electron.build/](https://www.electron.build/)  
38. Target Selection Guide | electron-builder, accessed June 15, 2026, [https://www.electron.build/docs/targets/](https://www.electron.build/docs/targets/)  
39. Investigate integrated auto-update mechanism for RStudio Desktop · Issue \#17173 \- GitHub, accessed June 15, 2026, [https://github.com/rstudio/rstudio/issues/17173](https://github.com/rstudio/rstudio/issues/17173)  
40. Distribution | electron-vite, accessed June 15, 2026, [https://electron-vite.org/guide/distribution](https://electron-vite.org/guide/distribution)  
41. macOS Notarization | electron-builder, accessed June 15, 2026, [https://www.electron.build/docs/features/code-signing/notarization/](https://www.electron.build/docs/features/code-signing/notarization/)  
42. Troubleshooting | electron-builder, accessed June 15, 2026, [https://www.electron.build/docs/troubleshooting/](https://www.electron.build/docs/troubleshooting/)  
43. 'installing native dependencies' dependency not included for all platforms · Issue \#8528 · electron-userland/electron-builder \- GitHub, accessed June 15, 2026, [https://github.com/electron-userland/electron-builder/issues/8528](https://github.com/electron-userland/electron-builder/issues/8528)  
44. macOS | electron-builder, accessed June 15, 2026, [https://www.electron.build/docs/mac/](https://www.electron.build/docs/mac/)  
45. Electron builder with Apple notarization stuck : r/electronjs \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1mncz6u/electron\_builder\_with\_apple\_notarization\_stuck/](https://www.reddit.com/r/electronjs/comments/1mncz6u/electron_builder_with_apple_notarization_stuck/)  
46. Enable hardened runtime for macOS · Issue \#3383 · electron-userland/electron-builder, accessed June 15, 2026, [https://github.com/electron-userland/electron-builder/issues/3383](https://github.com/electron-userland/electron-builder/issues/3383)  
47. Auto Update | electron-builder, accessed June 15, 2026, [https://www.electron.build/docs/features/auto-update/](https://www.electron.build/docs/features/auto-update/)  
48. Automatically Updating Electron Apps for Mac and Windows | by Christopher Metzner, accessed June 15, 2026, [https://medium.com/@chris.engineer.life/automatically-updating-electron-apps-for-mac-and-windows-b6b31c44680d](https://medium.com/@chris.engineer.life/automatically-updating-electron-apps-for-mac-and-windows-b6b31c44680d)  
49. Implementing Auto-Updates in Electron with electron-updater \- NishikantaRay, accessed June 15, 2026, [https://blog.nishikanta.in/implementing-auto-updates-in-electron-with-electron-updater](https://blog.nishikanta.in/implementing-auto-updates-in-electron-with-electron-updater)  
50. Auto-updater fails on macOS: "ZIP file not provided" (v0.17.6) · Issue \#982 · amd/gaia, accessed June 15, 2026, [https://github.com/amd/gaia/issues/982](https://github.com/amd/gaia/issues/982)  
51. electron-react-typescript-template · GitHub Topics, accessed June 15, 2026, [https://github.com/topics/electron-react-typescript-template](https://github.com/topics/electron-react-typescript-template)  
52. I built a Vite-based Electron \+ React CLI scaffolder because ERB's Webpack was driving me insane : r/electronjs \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1svp0ry/i\_built\_a\_vitebased\_electron\_react\_cli\_scaffolder/](https://www.reddit.com/r/electronjs/comments/1svp0ry/i_built_a_vitebased_electron_react_cli_scaffolder/)  
53. A modern Electron application boilerplate built with Vite, React, TypeScript, and DaisyUI. \- GitHub, accessed June 15, 2026, [https://github.com/kethakav/electron-vite-react-boilerplate](https://github.com/kethakav/electron-vite-react-boilerplate)  
54. auto-updater · GitHub Topics, accessed June 15, 2026, [https://github.com/topics/auto-updater?o=desc\&s=stars](https://github.com/topics/auto-updater?o=desc&s=stars)