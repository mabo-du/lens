# **Architectural Paradigms for Multimedia Annotation in Qualitative Data Analysis Software**

The transition of qualitative data analysis software from text-only transcription coding environments to fully integrated, multi-dimensional multimedia annotation ecosystems represents a profound increase in architectural complexity. Designing an open-source desktop qualitative data analysis application necessitates early and rigorous structural planning to accommodate advanced image region coding and synchronized audio or video transcription methodologies without incurring prohibitive technical debt. When engineering a minimum viable product with a strategic roadmap expanding into complex multimedia capabilities, the underlying data models, asset import pipelines, and export schemas must natively support spatial coordinate geometries, temporal segmentations, and synchronous transcript linking from the foundational design phase.  
This technical report provides an exhaustive investigation into the architectural scoping of image and multimedia annotation mechanisms. By evaluating proprietary implementations, assessing open-source canvas manipulation libraries, proposing highly scalable relational data models, and meticulously examining the rigid constraints of the interoperability standard, this analysis formulates a robust and highly detailed blueprint for developing modern, extensible qualitative analysis systems within a React and Electron context.

## **Implementations of Image Coding in Existing Ecosystems**

Understanding the historical and contemporary paradigms of proprietary and open-source software reveals vital insights into user interface design, spatial coordinate tracking, and the persistent challenges of media rendering across varying display environments. The dominant commercial platforms in the qualitative research sector, alongside leading open-source solutions, employ distinct and often contrasting approaches to defining, storing, and analyzing image region codes.

### **The Coordinate Architecture of NVivo**

NVivo approaches visual data annotation by utilizing an absolute pixel-based coordinate system to manage its picture references.1 When a researcher analyzes an imported image file or a static portable document format file, they define a region of interest by drawing a traditional bounding box. The software's internal engine captures and stores the exact top-left and bottom-right pixel coordinates to define this coded boundary permanently.1 These spatial bounding box annotations act as definitive references linked to specific thematic nodes, identified sentiments, or defined case classifications.2 Documentation for NVivo 14 Windows illustrates that picture references are explicitly represented as pixel coordinates defining the coded area, accessible via the Reference View which displays the full picture alongside the highlighted segment.2  
However, relying entirely on storing absolute pixel coordinates introduces systemic fragility into the data model. If an image asset is subsequently resized, structurally compressed, or re-imported at a differing resolution by the user, the static pixel coordinates stored in the database will no longer geometrically align with the semantic content of the visual artifact. To compensate for the rigidity of its spatial storage, NVivo offers a robust aggregation and reporting layer. The properties of a specific node can dynamically summarize the geometric area percentages of an overall file that have been coded, allowing researchers to assess the aggregate proportion of the image dedicated to a specific theme without relying solely on raw pixel data for their qualitative conclusions.2 The documentation regarding NVivo 14 Windows nodes and review references can be examined at https://community.lumivero.com/s/article/NV14Win-Content-nodes-review-references-in-a-node.2

### **The Spatial Methodology of ATLAS.ti**

ATLAS.ti shares a structural similarity with NVivo, relying predominantly on an absolute pixel-coordinate system for defining graphical quotations. The software formally identifies graphic quotations through the strict coordinates of the upper-left and lower-right corners of the user's selection.4 Furthermore, the geometric extent of the quotation is quantified mathematically by the absolute height in pixels of the defined rectangle.4  
ATLAS.ti distinguishes its user interface paradigm by emphasizing a highly conceptual network approach, wherein these geographically locked spatial quotations are linked via complex "density" matrices to other textual or audio quotations across the project workspace.6 Density, in this context, is defined mathematically as the number of linkages between two codes, which researchers cultivate manually to build grounded theory networks.6 Because ATLAS.ti severely restricts graphic annotations to simple bounding box rectangles anchored by absolute pixel data, the system faces the exact same display scaling vulnerabilities as its competitors, necessitating strict high-fidelity original file retention to ensure coordinates do not drift over time. Documentation detailing the Quotation Manager and spatial references can be found at https://doc.atlasti.com/ManualWin/Managers/ManagerForQuotations.html.5

### **Dynamic Region Capabilities in MAXQDA**

MAXQDA introduces a slightly more flexible paradigm regarding how visual data is presented, quantified, and manipulated by the researcher. It supports the traditional coding of specific image segments and allows users to highlight areas with specific colors, intentionally mirroring the paradigm of physical text highlighting.8 A unique architectural constraint enforced within the MAXQDA environment is that the software actively prevents the overlapping of segments tagged with the exact same code.8 However, overlapping regions associated with distinct, different codes are fully permitted and visually rendered.  
If the geometric size of a previously coded segment is modified by the user, MAXQDA contains internal event listeners that dynamically recalculate the segment boundaries and automatically correct the database entry.8 Furthermore, the software provides an advanced "Code Coverage" analysis tool that calculates the coded area in pictures as a proportional percentage relative to the total bounding size of the original image.9 While the internal storage layer relies on absolute coordinates for rendering precision, this percentage-based analytical output provides researchers with highly proportional, screen-agnostic insights.9 MAXQDA also pioneers the integration of external geographic data, supporting "Geolinks" that connect specific coded image segments to real-world global positioning system coordinates via KML files imported from external sources like Google Earth, providing a bridge between qualitative coding and geospatial mapping.11 Comprehensive documentation on MAXQDA's Code Coverage tool is hosted at https://www.maxqda.com/help/analyze-coded-segments/code-coverage.9

### **The Open-Source Paradigm of QualCoder**

QualCoder, a prominent open-source alternative built on the Python programming language and the PyQt graphical framework, approaches image annotation through a rigidly structured relational database model.12 Annotations are stored persistently in the code\_image SQLite table, utilizing the specific schema columns x1, y1, width, and height.12 These geometric parameters are recorded as absolute integers. QualCoder is architecturally designed to inherently support standard data exchange formats, mapping its internal SQLite integer records directly to XML nodes upon export.12  
Because the software must parse, scale, and re-render standard photographic images alongside complex portable document format visual segments, the user interface implementation leverages the Qt framework's graphical scene components to draw overlay bounding boxes over the loaded media asynchronously.13 QualCoder fundamentally supports overlapping regions without the strict code-matching restrictions observed in MAXQDA. Information regarding the internal table schemas and database queries can be accessed via the project's GitHub repository discussions and wiki pages at https://github.com/ccbogel/QualCoder/wiki/15-Sqlite-data-structure.15

### **Synthesis of UI Paradigms and Coordinate Systems**

The following table synthesizes the architectural approaches of the evaluated qualitative analysis platforms regarding image region annotation.

| Software Platform | UI Annotation Paradigm | Coordinate Storage Method | Coordinate System Type | Overlapping Region Handling |
| :---- | :---- | :---- | :---- | :---- |
| **NVivo** | Bounding Box Rectangle | Top-Left ![][image1], Bottom-Right ![][image1] | Absolute Pixel Integer | Supports overlapping layers |
| **ATLAS.ti** | Bounding Box Rectangle | Upper-Left ![][image1], Lower-Right ![][image1] | Absolute Pixel Integer | Supports overlapping layers |
| **MAXQDA** | Highlighted Rectangle | Segment boundaries, Extent height | Absolute Pixel (calculates %) | Denies identical code overlap |
| **QualCoder** | Bounding Box Rectangle | Origin ![][image2], ![][image3], Width, Height | Absolute Pixel Integer | Supports overlapping layers |

A critical, unifying insight derived from analyzing these existing systems is the nearly universal reliance on absolute pixel coordinates for defining bounding boxes. While this methodology significantly simplifies the internal mathematics of the desktop application by mapping directly to the intrinsic resolution of the source file, it creates severe interoperability and responsive scaling friction for modern applications. In contemporary React or Electron-based interfaces, the display canvas continuously fluctuates based on window resizing events, user zoom states, and the varying device pixel ratios (DPI) of modern high-resolution monitors. Consequently, mapping absolute pixels to a dynamic viewport requires continuous, resource-intensive mathematical transformations on the client side to prevent graphical desynchronization.

## **Evaluation of Canvas-Based Region Drawing Libraries**

Architecting a cross-platform desktop application using React and Electron requires a robust frontend rendering engine capable of managing high-resolution raster images, plotting complex interactive geometries over those images, and tightly binding those geometric properties to the application's global state management system. The open-source JavaScript ecosystem offers several mature libraries for canvas manipulation. The evaluation of these libraries for a qualitative data analysis use case hinges on React integration quality, the raw size of the dependency bundle, support for complex multi-point polygons alongside freehand drawing, and the active maintenance status of the repository.

### **Analysis of react-image-annotate**

The react-image-annotate package, maintained by the UniversalDataTool organization, is a library specifically designed for image classification and region tagging tasks, natively supporting bounding boxes, multi-point polygons, and isolated point annotations.17 The repository is located at https://github.com/UniversalDataTool/react-image-annotate.18  
However, an exhaustive analysis of its GitHub repository issues reveals significant architectural decay and a lack of ongoing maintenance. Users attempting modern integrations consistently report severe dependency conflicts, specifically involving outdated peer dependencies for legacy React versions (e.g., react@"^16.8.0"), which fail when resolving dependencies in modern npm environments.19 Furthermore, integration into contemporary build pipelines often results in module parsing errors, such as Unexpected token failures during webpack compilations.20 Beyond build-time errors, runtime graphical anomalies are heavily documented; there are unresolved issues where images inexplicably shrink, hide, or invert their background colors when rendered within standard interface components like Material UI dialogs.17 Given these profound architectural instabilities, the presence of legacy peer dependencies, and the lack of active maintainer intervention, this library is highly discouraged for a foundational roadmap integration.

### **The Label Studio Frontend Architecture**

Label Studio distributes its core annotation interface as an independent, highly sophisticated open-source NPM package under the namespace @heartexlabs/label-studio.21 Engineered explicitly for complex machine learning data labeling, the frontend is built entirely using React and relies on mobx-state-tree for highly reactive, granular state management.21 The repository for the frontend component can be examined at https://github.com/HumanSignal/label-studio-frontend.24  
This library offers exceptional functional coverage. It natively supports standard bounding boxes, complex editable multipoint polygons, and freehand brush masks. Because it is engineered for generating artificial intelligence training data, it seamlessly handles hundreds of overlapping geometric layers, allowing developers to implement granular customization of stroke widths, opacities, and fill colors. This capability is paramount for qualitative coding, where overlapping regions require distinct visual styles to differentiate applied thematic codes. The React integration is outstanding due to the MobX state tree, which allows developers to easily interface the canvas events with standard React contexts.23 The primary drawback of the Label Studio frontend is its substantial bundle size. Because it is distributed as a comprehensive monolithic package encompassing audio, video, text, and time-series annotation modules, it may introduce unnecessary bloat into an Electron application if the developer only requires the 2D image canvas module.22

### **Implementation Viability of Fabric.js**

Fabric.js represents one of the most foundational HTML5 canvas libraries available, providing a highly interactive, object-oriented model on top of the native browser canvas application programming interface. It natively supports drawing rectangles, parsing and rendering complex SVG path strings, and processing freehand brush strokes. It excels in visual styling, supporting complex Z-index layering for overlapping codes, custom opacities, and dynamic color assignments. Furthermore, the repository is highly active with a vast open-source community ensuring long-term maintenance.  
The critical architectural flaw of Fabric.js within the context of the proposed application is its lack of a native, declarative React wrapper. Integrating Fabric.js into a React environment requires the developer to manually synchronize React component lifecycles with the imperative Fabric canvas instance using useRef and useEffect hooks. This manual DOM manipulation frequently leads to severe memory leaks if event listeners, such as mouse dragging or object scaling, are not properly garbage-collected when the React component unmounts.

### **The Declarative Approach of Konva.js**

Konva.js is an advanced 2D canvas library engineered specifically for high-performance desktop and mobile applications, optimized for rapid rendering through layered node trees. Unlike Fabric.js, Konva.js features a flawless integration with React via the react-konva wrapper package. This wrapper allows software engineers to declare canvas elements—such as the Stage, Layer, Rect, and Line—purely as declarative React components, keeping the physical Document Object Model and the virtual React state perfectly synchronized without manual intervention.  
Konva.js supports bounding box rectangles, complex polygons, and freehand drawing, which is achieved by rendering continuous line objects parameterized with specific tension values to smooth the visual curve. Regarding performance, Konva natively handles thousands of distinct geometric objects while maintaining high frame rates. It achieves this by utilizing multiple internal HTML5 canvas layers, redrawing only the layers that experience state mutations. This specific performance optimization is critical for qualitative data projects, which frequently feature hundreds of heavily overlapping, uniquely colored code polygons layered over a single archival map or high-resolution photograph.

### **Alternative Libraries within the Ecosystem**

An examination of the broader image-annotation GitHub topic reveals several alternative libraries, though none match the enterprise readiness of Konva.js or Label Studio.

* **Annotate Lab** (sumn2u/annotate-lab): This project combines a React frontend with a Python Flask server, incorporating advanced auto-bounding box selection via the Segment Anything Model (SAM).25 While the machine learning integration is advanced, the library relies on a decoupled server architecture that is not easily portable to an offline-first SQLite Electron application.25  
* **Dash Picture Annotation** (cainmagi/dash-picture-annotation): This library acts as a component wrapper for Plotly Dash applications, porting earlier React implementations.26 It is heavily tailored for Python-based data visualization pipelines rather than standalone desktop applications.26  
* **react-image-annotation** (Secretmapper/react-image-annotation): An older React component offering draggable toolbars and specific props for active annotation comparison and overlapping.27 However, it lacks the broader community support and ongoing performance optimization found in contemporary canvas engines.

### **Comparative Summary of Canvas Libraries**

| JavaScript Library | Primary UI Paradigm | React Integration Quality | Overlapping Visuals Support | Maintenance Status & Outlook |
| :---- | :---- | :---- | :---- | :---- |
| **react-image-annotate** | Class-based React | Poor (Legacy peer dependencies) | Supported (with bugs) | Decaying; unresolved rendering issues |
| **Label Studio Frontend** | MobX State Tree | Excellent | Exceptional (designed for ML) | Highly active; large monolithic bundle |
| **Fabric.js** | Imperative Canvas API | Poor (Requires manual hook lifecycle) | Excellent | Highly active; prone to memory leaks |
| **Konva.js (react-konva)** | Declarative Virtual DOM | Exceptional | Excellent (optimized layering) | Highly active; highly performant |

Based on this evaluation, react-konva represents the most viable and robust architectural choice for the application frontend. It abstracts the complex imperative canvas API into the standard declarative React paradigm, prevents memory leakage, and remains significantly more lightweight than the monolithic Label Studio frontend package.

## **Region Annotation Data Model Formulation**

Storing image region annotations persistently in an offline SQLite database requires formulating a schema that balances rapid query performance, rendering precision, and absolute resilience to dynamic image transformations across variable hardware displays. A comparative analysis of potential storage structures reveals distinct architectural trade-offs that must be navigated.

### **Evaluation of Storage Formats**

1. **Absolute Bounding Box Coordinates**: This format stores the exact ![][image4], ![][image5], width, and height as absolute pixels, mirroring the implementation utilized by QualCoder.12 While it is computationally inexpensive to query, it breaks entirely if an image is downscaled for storage efficiency or if the user replaces the source image with a higher-resolution version, as the absolute pixel integer will no longer point to the correct visual feature.  
2. **Polygon JSON Array**: Storing a region as a serialized JSON array of points (e.g., \[\[x1,y1\], \[x2,y2\],...\]) allows for complex freehand and geometric regions. When stored as text in SQLite, it requires JSON parsing at the application layer to render. If these points are absolute, it suffers the same vulnerabilities as the absolute bounding box.  
3. **SVG Path String**: Storing regions as standard Scalable Vector Graphics path strings is highly compact and universally understood by browser rendering engines. It is extremely scalable and easy to inject directly into DOM elements or canvas libraries like Fabric.js. However, parsing exact coordinates out of complex bezier curve strings for subsequent analytical reporting (such as area calculation) requires heavy computational overhead.  
4. **W3C Web Annotation Data Model (WADM)**: The W3C specification employs the FragmentSelector model, establishing a globally recognized syntax for defining spatial selections. WADM allows developers to format selectors flexibly, utilizing syntax strings such as xywh=pixel:100,50,200,150 for absolute boundaries, or xywh=percent:19,40,39,27 for proportional boundaries.29

### **Architectural Recommendation: The Hybrid Proportional Model**

To architect a system that is robust against responsive UI resizing and original image scaling, the underlying coordinate system must be proportional, utilizing percentage-based floating-point mathematics. The W3C FragmentSelector specification, specifically leveraging the xywh=percent syntax, provides the ideal theoretical foundation for this approach.30 By recording the coordinate vectors as floating-point percentages of the image's intrinsic width and height, the React application can accurately and mathematically redraw the annotation overlay regardless of the display window's physical size or the image's current pixel density.  
However, a critical architectural conflict arises regarding interoperability. The standard explicitly requires absolute pixel values for its PictureSelection XML elements, specifically demanding firstX, firstY, secondX, and secondY integer attributes.12 Therefore, to ensure internal UI stability while maintaining external compatibility, the database schema must store the proportional coordinate data to drive the frontend, alongside the intrinsic pixel dimensions of the original source media at the exact moment the file was imported. When an export routine is triggered by the user, the application's backend mathematically reconstructs the absolute pixel boundaries in real-time by multiplying the stored percentages by the stored intrinsic dimensions, satisfying the XML schema requirements without compromising the internal responsive UI.

### **Proposed SQLite Schema Definition**

The following SQLite schema defines the image\_annotations table, integrating proportional geometry alongside intrinsic pixel metadata.

| Column Identifier | SQL Data Type | Functional Description and Architecture |
| :---- | :---- | :---- |
| id | TEXT (UUID) | Primary key, cryptographically uniquely identifying the visual annotation segment. |
| source\_id | TEXT (UUID) | Foreign key relation referencing the parent image asset record. |
| code\_id | TEXT (UUID) | Foreign key relation referencing the specific semantic or thematic code applied. |
| geometry\_type | TEXT | Enumerated string defining the shape class, e.g., RECTANGLE, POLYGON, or FREEHAND. |
| geometry\_data | TEXT (JSON) | Serialized proportional coordinates. For a bounding box: {"x": 0.15, "y": 0.20, "w": 0.35, "h": 0.40}. For polygons: an array of percentage coordinate objects. |
| intrinsic\_w | INTEGER | The original, unaltered width of the source image in pixels at the exact time of import. |
| intrinsic\_h | INTEGER | The original, unaltered height of the source image in pixels at the exact time of import. |
| created\_at | INTEGER | Unix epoch timestamp indicating creation, required for standardized metadata tracking. |

This hybrid relational data model guarantees complete resilience to fluid user interface resizing, fundamentally conforms to advanced W3C semantic data architectures, and retains the necessary historical metadata to execute compliance algorithms required for interoperability flawlessly.12

## **Audio and Video Annotation Architecture**

The integration of time-based media—audio recordings and video files—into a qualitative framework fundamentally shifts the analytical processing dimension from geometric spatial planes to linear temporal vectors. Managing video and audio necessitates highly specific local storage architectures, precise temporal linking methodologies, and performant waveform visualization interfaces that do not crash the underlying Electron browser context.

### **Local Media Storage and Referencing Methodologies**

To maintain project portability and prevent systemic data corruption, media assets must be isolated and localized. A common architectural failure in qualitative applications involves relying on absolute operating system paths (e.g., C:/Users/Research/project/audio.mp3) to link media. If the project bundle is compressed and transferred to a collaborator utilizing a macOS environment, the absolute paths instantly break, resulting in unplayable media.32  
The optimal architecture demands that the application's import pipeline systematically copies or moves the user's selected media assets into an isolated /assets/media/ subdirectory contained entirely within the application's project bundle directory. Subsequently, the database must store strictly relative paths.12 QualCoder implements a functional version of this isolation architecture by supporting internal relative paths recorded as /audio/filename.mp3 or /video/filename.mp4 within its core source tables.12 This guarantees that as long as the parent directory remains intact, the relative linkages resolve successfully regardless of the host operating system.

### **Temporal Annotation Data Structures**

For time-based temporal annotations, the core relational data structure relies on capturing precise millisecond timestamps to link a specific span of media to a qualitative code. QualCoder exemplifies this approach by storing these values in a dedicated code\_av table. The table utilizes the schema fields pos0 to record the segment start point in exact milliseconds, and pos1 to record the segment endpoint in milliseconds, existing alongside the cid (code identifier) to establish the relational link.12 This specific module architecture and its associated SQL execution queries can be reviewed directly in the QualCoder source code repository at https://github.com/ccbogel/QualCoder/blob/master/src/qualcoder/refi.py.12

### **Waveform Visualization: Analyzing Peaks.js vs. WaveSurfer.js**

To allow researchers to accurately navigate and code an audio file, a visual waveform representation is functionally indispensable. The open-source landscape offers two primary candidates for integration: WaveSurfer.js and Peaks.js.34  
**WaveSurfer.js** is built extensively upon the browser's native Web Audio API and HTML5 Canvas, providing an easily navigable and highly customizable waveform interface.34 However, it suffers from a critical architectural limitation regarding file scale. Because WaveSurfer.js decodes the entire audio file directly within the browser's memory matrix to mathematically draw the waveform, it experiences severe performance degradation and catastrophic memory exhaustion when instructed to load significantly large media files, such as a continuous three-hour focus group recording.  
**Peaks.js**, conversely, was developed by the British Broadcasting Corporation (BBC) specifically for interacting with massive audio waveforms in a constrained browser environment.35 Peaks.js deliberately circumvents the scalability limitations of the Web Audio API by utilizing pre-computed, offline waveform data files. To achieve this, the backend processes the audio using binary utilities (such as audiowaveform) to generate a highly compressed integer dataset (.dat or .json format), which the Peaks.js frontend then consumes natively. This decoupled architecture allows for near-instant visual rendering and seamless, stutter-free zooming across massive audio files without threatening the browser's audio context memory limits.36 Furthermore, Peaks.js natively supports rendering interactive "segments" and "point markers" over the waveform, which conceptually aligns perfectly with the requirement to display qualitative temporal segment coding.36  
**Architectural Recommendation**: For an Electron-based application, Peaks.js is undeniably the superior integration choice. The application's Node.js backend pipeline can silently invoke FFmpeg or an audiowaveform binary during the initial media import phase to rapidly generate the required lightweight waveform data file. Peaks.js will then consume this data, decoupling the intensive visual rendering process from the Electron browser's restrictive memory constraints.

## **Transcript Synchronisation Mechanisms**

The highest echelon of multimedia complexity within qualitative software involves bidirectionally synchronizing time-coded media annotations with specific textual transcript spans. When a researcher highlights a textual paragraph in the transcript editor, the embedded media player must instantly seek to that exact chronological moment; conversely, as a video plays linearly, the corresponding text within the editor must highlight dynamically to track the speaker's progress.14

### **Historical Synchronization Paradigms**

The Oral History Metadata Synchronizer (OHMS) pioneered this synchronization concept on a large scale. OHMS utilizes an advanced XML schema designed to drop invisible time stamps at regular, calculated intervals within a textual transcript, permanently tying specific textual segments to external metadata, global GPS coordinates, and media time codes.37 OHMS creates an interactive viewing matrix where the written transcript fundamentally acts as a navigational interface for the underlying media file.37 Extensive technical documentation detailing the OHMS architecture and import pipelines can be reviewed at https://www.oralhistoryonline.org/wp-content/uploads/2020/11/@OHMS\_user\_guide\_master\_v3-8-3.pdf.39  
Within the specific context of interoperability standards and QualCoder's implementation logic, this complex link is formalized through the generation of a SyncPoint.12 A synchronisation point acts as a discrete, invisible anchor correlating a precise millisecond timestamp in the media file (identified as timeStamp) with a specific character offset integer (identified as position) within the plain-text string of the transcript.12

### **The Whisper VTT Integration Model**

With the rapid advent and democratization of automated machine learning transcription models like OpenAI's Whisper, modern desktop platforms can autogenerate highly accurate transcripts locally. The Whisper architecture natively outputs transcriptions utilizing the .vtt (WebVTT) or .srt subtitle file formats. A standard WebVTT file inherently contains the exact structural data arrays required to build a functional synchronization matrix:  
00:01:14.000 \--\> 00:01:17.500  
Participant 1: The architecture must be scalable.  
To effectively map a Whisper-generated VTT file into the SQLite database, the backend import pipeline must execute a highly specific mathematical offset compilation sequence:

1. **Text Concatenation Routine**: The system must parse the VTT file, extract the raw text payloads from the individual subtitle blocks, and sequentially concatenate them into a single, continuous plain-text transcript payload. Crucially, the system must record the exact starting character integer index for each block as it is appended to the master string.  
2. **SyncPoint Generation Phase**: For every parsed VTT block, the system programmatically creates a relational SyncPoint entity. This entity links the block's extracted start time in milliseconds directly to the recorded start character integer index within the concatenated plain-text payload.12  
3. **Selection Linking Logic**: When a researcher subsequently applies a thematic code to the audio segment spanning 00:01:14.000 to 00:01:17.500 via the waveform interface, the system queries the generated SyncPoints to identify the corresponding character indices spanning that time code. It then simultaneously applies the qualitative code to both the audio vector and the text characters.12

This dual-binding synchronization architecture ensures that the definitive source of truth for the annotation can originate fluidly from either the media player interface or the text editor interface without risking data fragmentation or logic conflicts.

## **Multimedia Interoperability and Compliance Standards**

To guarantee that the application's V2+ architecture does not inadvertently isolate user data in a proprietary format, the system must natively and strictly comply with the Research Exchange Format for Interoperability (REFI-QDA).41 The REFI standard formally defines specific XML schema definitions within its Projects.xsd specification, explicitly designed for transferring complex qualitative project metadata losslessly between disparate platforms such as NVivo, ATLAS.ti, MAXQDA, and QualCoder.43 The schema documentation and utilities for REFI compliance are hosted at the openqda repository: https://github.com/openqda/refi-tools.44

### **Architecting the Image Annotation Schema (PictureSelection)**

The REFI .qdpx format encapsulates image region annotations within a strict \<PictureSelection\> XML tag, nested structurally beneath the relevant source asset definition.12 The attributes require the generation of universally unique identifiers (GUIDs) and demand absolute pixel integers defining a spatial bounding box.

XML  
\<PictureSelection   
    guid\="04980e59-b290-4481-8cb6-e732824440a1"   
    firstX\="783"   
    firstY\="1238"   
    secondX\="1172"   
    secondY\="1788"   
    name\="Area of interest"\>  
    \<Description\>Optional memo regarding this specific image region.\</Description\>  
    \<Coding guid\="f1d221e5-fa3a-4b9a-865c-7712cd428c62"\>  
        \<CodeRef targetGUID\="d342cd5e-52d1-4894-a342-7d42ed947797" /\>  
    \</Coding\>  
\</PictureSelection\>

**Architectural Implication**: Because the REFI standard explicitly rejects percentage-based geometries or complex polygonal path strings, the internal application data pipeline must actively compute the absolute bounding box integers (firstX, firstY, secondX, secondY) during the export compilation routine. It achieves this by calculating the internal, responsive proportional coordinates against the originally logged intrinsic\_w and intrinsic\_h metadata parameters stored in the database.12

### **Structuring Audio and Video Annotations (AudioSelection / VideoSelection)**

Temporal media annotations are defined utilizing standardized \<AudioSelection\> and \<VideoSelection\> XML tags.12 The critical operational attributes are begin and end, which denote the boundaries of the user's selection strictly in milliseconds.12

XML  
\<VideoSelection   
    guid\="0EF270BA-47AD-4107-B78F-7697362BCA44"   
    begin\="14706"   
    end\="17706"   
    name\="00:14.70 \- 00:17.70"\>  
    \<Coding guid\="ee856ef0-6296-4fd3-8e5a-5e3d202a145c"\>  
        \<CodeRef targetGUID\="0bd904ef-7dff-47d6-a94e-f47e9134a596" /\>  
    \</Coding\>  
\</VideoSelection\>

**Architectural Implication**: The proposed SQLite data model, which persistently stores pos0 and pos1 as exact millisecond integers, maps flawlessly and immediately to this XML requirement. This architectural alignment entirely avoids the computational overhead of translating timecode string formats (e.g., hh:mm:ss.ms) during high-volume data exports.12

### **The Complexities of the Transcript Synchronisation Schema**

The most profound structural complexity of the REFI-QDA standard lies in accurately mapping synchronized textual transcripts.12 A primary \<Transcript\> tag is instantiated representing the imported or generated plain-text file. Inside this parent container, the schema rigorously defines independent \<SyncPoint\> elements and relational \<TranscriptSelection\> elements.

1. **SyncPoint Elements**: These tags definitively establish the mathematical relationship between the string character offset (defined as position) and the media timecode (defined as timeStamp in milliseconds).12  
2. **TranscriptSelection Elements**: Instead of utilizing absolute millisecond time codes to define the coded text, a transcript coding relies entirely on referencing the generated guid of the previously defined SyncPoints to establish its start and end boundaries.12

XML  
\<Transcript plainTextPath\="internal://0a1b2c.txt" guid\="abcde123-..." name\="Interview 1"\>  
    \<SyncPoint guid\="d7c91d8c-77f6-4058-b21e-010a157ba027" position\="450" timeStamp\="14706" /\>  
    \<SyncPoint guid\="01809d1d-40a9-4941-8685-c5eafa9de319" position\="920" timeStamp\="17706" /\>  
      
    \<TranscriptSelection   
        guid\="ecdbd559-e5d2-45b4-bb60-54e2530de054"   
        fromSyncPoint\="d7c91d8c-77f6-4058-b21e-010a157ba027"   
        toSyncPoint\="01809d1d-40a9-4941-8685-c5eafa9de319"   
        name\="Transcript Segment 1"\>  
        \<Coding guid\="f1d221e5..."\>  
            \<CodeRef targetGUID\="0bd904ef..." /\>  
        \</Coding\>  
    \</TranscriptSelection\>  
\</Transcript\>

This strict interoperability constraint dictates that the desktop application's underlying relational database must store, or be capable of deterministically generating, a network of independent SyncPoint entities. A robust database schema must feature a dedicated sync\_points table linking the media\_asset\_id, transcript\_asset\_id, char\_index, and ms\_timestamp together. This structure allows the application backend to dynamically assemble these complex XML nodes without suffering data loss or coordinate drift during the final .qdpx file compilation sequence.12  
The expansion of a qualitative data analysis application to incorporate multimedia functionality fundamentally necessitates a transition from simple textual offset models to highly complex, multi-dimensional relational data tracking systems. By comprehensively evaluating the technical methodologies of established proprietary platforms and rigorously analyzing core open-source interoperability standards, a definitive architectural strategy is successfully established for the early-stage integration.  
For image annotation architectures, deliberately avoiding the inherent fragility of absolute pixel bounding boxes, a flaw prominently utilized by legacy platforms, is paramount. Implementing the advanced W3C Web Annotation Data Model's percentage-based geometries, specifically utilizing the xywh=percent syntax within an internal SQLite JSON schema structure, ensures that spatial annotations scale perfectly and proportionately across an infinite array of varying screen sizes and device pixel ratios.29 Utilizing a highly optimized, declarative library such as react-konva for the frontend canvas layer allows for complex, layered React-integrated vector rendering with virtually no performance overhead or memory leakage. During the interoperable export phase, the application backend can securely and rapidly synthesize the REFI-QDA required absolute coordinates by mathematically processing the internal proportional geometry against the meticulously retained original asset dimension metadata variables.  
Similarly, adopting the offline-rendered Peaks.js architecture alongside strictly localized internal asset storage paths ensures that the qualitative software can reliably visualize and effortlessly navigate large-scale temporal media. This crucial architectural decision prevents the application from succumbing to the severe memory constraints and crash vulnerabilities native to the browser's Web Audio API.34 By systematically mapping Whisper-generated WebVTT timestamp structures to internal SQLite SyncPoint architectures, the application achieves seamless functional parity with established models like OHMS and fully complies with standard REFI-QDA synchronization matrices.12 Engineering the underlying database schema to natively reflect these specific inter-relational spatial and temporal nodes on day one ensures the application inherently avoids the vast technical debt associated with attempting to migrate un-synchronized or un-anchored metadata during the later stages of the development lifecycle.

#### **Works cited**

1. Pictures (NVivo 14 Windows) \- Lumivero, accessed June 15, 2026, [https://community.lumivero.com/s/article/NV14Win-Content-files-pictures](https://community.lumivero.com/s/article/NV14Win-Content-files-pictures)  
2. Coding references (NVivo 14 Windows) \- Lumivero, accessed June 15, 2026, [https://community.lumivero.com/s/article/NV14Win-Content-nodes-review-references-in-a-node](https://community.lumivero.com/s/article/NV14Win-Content-nodes-review-references-in-a-node)  
3. Chapter 6 – Working at Data Level (NVIVO) | Online Resources, accessed June 15, 2026, [https://study.sagepub.com/using-software-in-qualitative-research/student-resources/step-by-step-software-guides/nvivo-10-1](https://study.sagepub.com/using-software-in-qualitative-research/student-resources/step-by-step-software-guides/nvivo-10-1)  
4. ATLAS.ti 26 Windows – User Manual, accessed June 15, 2026, [https://manuals.atlasti.com/Win/en/manual/ATLAS.ti\_ManualWin.pdf](https://manuals.atlasti.com/Win/en/manual/ATLAS.ti_ManualWin.pdf)  
5. Quotation Manager \- ATLAS.ti 23 Windows \- User Manual, accessed June 15, 2026, [https://doc.atlasti.com/ManualWin/Managers/ManagerForQuotations.html](https://doc.atlasti.com/ManualWin/Managers/ManagerForQuotations.html)  
6. Coding Data \- Basic Concepts \- ATLAS.ti 23 Windows \- User Manual, accessed June 15, 2026, [https://doc.atlasti.com/ManualWin/Codes/CodingDataBasicConcepts.html](https://doc.atlasti.com/ManualWin/Codes/CodingDataBasicConcepts.html)  
7. Coding Data \- ATLAS.ti 9 Windows \- User Manual, accessed June 15, 2026, [https://doc.atlasti.com/ManualWin.v9/Codes/CodingData.html](https://doc.atlasti.com/ManualWin.v9/Codes/CodingData.html)  
8. Reference Manual MAXQDDA 11 \- maxqda, accessed June 15, 2026, [https://www.maxqda.com/download/manuals/MAX11\_manual\_eng.pdf](https://www.maxqda.com/download/manuals/MAX11_manual_eng.pdf)  
9. Code Coverage \- MAXQDA, accessed June 15, 2026, [https://www.maxqda.com/help/analyze-coded-segments/code-coverage](https://www.maxqda.com/help/analyze-coded-segments/code-coverage)  
10. Document Comparison Chart (Sequence of Codings) \- MAXQDA, accessed June 15, 2026, [https://www.maxqda.com/help/visual-tools/document-comparison-chart-a-visual-comparison-of-coded-text](https://www.maxqda.com/help/visual-tools/document-comparison-chart-a-visual-comparison-of-coded-text)  
11. Geolinks \- MAXQDA 2022 Manual, accessed June 15, 2026, [https://www.maxqda.com/help-mx22/links/geolinks](https://www.maxqda.com/help-mx22/links/geolinks)  
12. QualCoder/src/qualcoder/refi.py at master · ccbogel/QualCoder \- GitHub, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/blob/master/src/qualcoder/refi.py](https://github.com/ccbogel/QualCoder/blob/master/src/qualcoder/refi.py)  
13. QualCoder 3.4 \#828 \- GitHub, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/discussions/828](https://github.com/ccbogel/QualCoder/discussions/828)  
14. 3.2. Files · ccbogel/QualCoder Wiki \- GitHub, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/wiki/3.2.-Files](https://github.com/ccbogel/QualCoder/wiki/3.2.-Files)  
15. Home · ccbogel/QualCoder Wiki \- GitHub, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/wiki/Home/85e908e98fc467d178dae86bdb03433e1f6c6479](https://github.com/ccbogel/QualCoder/wiki/Home/85e908e98fc467d178dae86bdb03433e1f6c6479)  
16. I need a schema to view the SQL tables · ccbogel QualCoder · Discussion \#896 \- GitHub, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/discussions/896](https://github.com/ccbogel/QualCoder/discussions/896)  
17. Issues · UniversalDataTool/react-image-annotate \- GitHub, accessed June 15, 2026, [https://github.com/UniversalDataTool/react-image-annotate/issues](https://github.com/UniversalDataTool/react-image-annotate/issues)  
18. UniversalDataTool/react-image-annotate \- GitHub, accessed June 15, 2026, [https://github.com/UniversalDataTool/react-image-annotate](https://github.com/UniversalDataTool/react-image-annotate)  
19. Support React 17 · Issue \#186 · UniversalDataTool/react-image-annotate \- GitHub, accessed June 15, 2026, [https://github.com/UniversalDataTool/react-image-annotate/issues/186](https://github.com/UniversalDataTool/react-image-annotate/issues/186)  
20. Error when importing · Issue \#37 · UniversalDataTool/react-image-annotate \- GitHub, accessed June 15, 2026, [https://github.com/UniversalDataTool/react-image-annotate/issues/37](https://github.com/UniversalDataTool/react-image-annotate/issues/37)  
21. Frontend builds \- Label Studio, accessed June 15, 2026, [https://labelstud.io/guide/frontend.html](https://labelstud.io/guide/frontend.html)  
22. Package label-studio \- GitHub, accessed June 15, 2026, [https://github.com/orgs/HumanSignal/packages/npm/package/label-studio](https://github.com/orgs/HumanSignal/packages/npm/package/label-studio)  
23. Label Studio is a multi-type data labeling and annotation tool with standardized output format \- GitHub, accessed June 15, 2026, [https://github.com/HumanSignal/label-studio](https://github.com/HumanSignal/label-studio)  
24. GitHub \- HumanSignal/label-studio-frontend: Data labeling react app that is backend agnostic and can be embedded into your applications — distributed as an NPM package, accessed June 15, 2026, [https://github.com/HumanSignal/label-studio-frontend](https://github.com/HumanSignal/label-studio-frontend)  
25. Annotate-lab is an open-source image annotation tool for efficient dataset creation. With an intuitive interface and flexible export options, it streamlines your machine learning workflow. 🖼️✏️ · GitHub, accessed June 15, 2026, [https://github.com/sumn2u/annotate-lab](https://github.com/sumn2u/annotate-lab)  
26. cainmagi/dash-picture-annotation \- GitHub, accessed June 15, 2026, [https://github.com/cainmagi/dash-picture-annotation](https://github.com/cainmagi/dash-picture-annotation)  
27. Secretmapper/react-image-annotation \- GitHub, accessed June 15, 2026, [https://github.com/Secretmapper/react-image-annotation](https://github.com/Secretmapper/react-image-annotation)  
28. Created an open source image annotation library for react based projects \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/SideProject/comments/1ou7wd0/created\_an\_open\_source\_image\_annotation\_library/](https://www.reddit.com/r/SideProject/comments/1ou7wd0/created_an_open_source_image_annotation_library/)  
29. semiont/docs/protocol/W3C-SELECTORS.md at main · The-AI, accessed June 15, 2026, [https://github.com/The-AI-Alliance/semiont/blob/main/docs/protocol/W3C-SELECTORS.md](https://github.com/The-AI-Alliance/semiont/blob/main/docs/protocol/W3C-SELECTORS.md)  
30. Nichesourcing for Improving Access to Linked Cultural Heritage Datasets \- VU Research Portal, accessed June 15, 2026, [https://research.vu.nl/ws/portalfiles/portal/77030686/complete+dissertation.pdf](https://research.vu.nl/ws/portalfiles/portal/77030686/complete+dissertation.pdf)  
31. Spatial Representation \- Layers Documentation, accessed June 15, 2026, [https://docs.layers.pub/guides/spatial-representation/](https://docs.layers.pub/guides/spatial-representation/)  
32. Need to change path to linked external text files · Issue \#1196 · ccbogel/QualCoder \- GitHub, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/issues/1196](https://github.com/ccbogel/QualCoder/issues/1196)  
33. Mac bugs \+ feature request: audio/subtitle track selection · Issue \#36 · ccbogel/QualCoder, accessed June 15, 2026, [https://github.com/ccbogel/QualCoder/issues/36](https://github.com/ccbogel/QualCoder/issues/36)  
34. Yuan-ManX/audio-development-tools: Audio Development Tools (ADT) is a project for advancing sound, speech, and music technologies, featuring components for machine learning, sound synthesis, speech and music generation, signal processing, game audio, digital audio workstations (DAWs), and more. · GitHub, accessed June 15, 2026, [https://github.com/Yuan-ManX/audio-development-tools](https://github.com/Yuan-ManX/audio-development-tools)  
35. zenml-io/awesome-open-data-annotation: Open Source Data Annotation & Labeling Tools, accessed June 15, 2026, [https://github.com/zenml-io/awesome-open-data-annotation](https://github.com/zenml-io/awesome-open-data-annotation)  
36. Immersive and Personalised Podcasting Using AI-driven Audio Production Tools \- White Rose eTheses Online, accessed June 15, 2026, [https://etheses.whiterose.ac.uk/id/eprint/36212/1/Thesis%20-%20REVISED.pdf](https://etheses.whiterose.ac.uk/id/eprint/36212/1/Thesis%20-%20REVISED.pdf)  
37. Synchronizing Oral History Text and Speech: A Tools Overview, accessed June 15, 2026, [https://academicworks.cuny.edu/cgi/viewcontent.cgi?article=1043\&context=jj\_pubs](https://academicworks.cuny.edu/cgi/viewcontent.cgi?article=1043&context=jj_pubs)  
38. OHMS \- Oral History in the Digital Age, accessed June 15, 2026, [https://ohda.matrix.msu.edu/2012/06/ohms-2/](https://ohda.matrix.msu.edu/2012/06/ohms-2/)  
39. OHMS (Oral History Metadata Synchronizer) User Guide, accessed June 15, 2026, [https://www.oralhistoryonline.org/wp-content/uploads/2020/11/@OHMS\_user\_guide\_master\_v3-8-3.pdf](https://www.oralhistoryonline.org/wp-content/uploads/2020/11/@OHMS_user_guide_master_v3-8-3.pdf)  
40. Case Study 9.3: Oral History Metadata Synchronizer—A Transcript Solution, accessed June 15, 2026, [https://opentext.wsu.edu/accessibility-case-studies/chapter/case-study9-ohms/](https://opentext.wsu.edu/accessibility-case-studies/chapter/case-study9-ohms/)  
41. REFI-QDA Project, accessed June 15, 2026, [https://www.qdasoftware.org/project](https://www.qdasoftware.org/project)  
42. 6 Teamwork \- Audiotranskription.de, accessed June 15, 2026, [https://www.audiotranskription.de/en/online-manual/6-teamwork/](https://www.audiotranskription.de/en/online-manual/6-teamwork/)  
43. Bridging the Gap Between AI and Reality \- ResearchGate, accessed June 15, 2026, [https://www.researchgate.net/publication/385423024\_AI\_and\_Democratic\_Equality\_How\_Surveillance\_Capitalism\_and\_Computational\_Propaganda\_Threaten\_Democracy/fulltext/6724b75d77b63d1220d27477/AI-and-Democratic-Equality-How-Surveillance-Capitalism-and-Computational-Propaganda-Threaten-Democracy.pdf](https://www.researchgate.net/publication/385423024_AI_and_Democratic_Equality_How_Surveillance_Capitalism_and_Computational_Propaganda_Threaten_Democracy/fulltext/6724b75d77b63d1220d27477/AI-and-Democratic-Equality-How-Surveillance-Capitalism-and-Computational-Propaganda-Threaten-Democracy.pdf)  
44. openqda/refi-tools: Utilities to implement REFI standard \- GitHub, accessed June 15, 2026, [https://github.com/openqda/refi-tools](https://github.com/openqda/refi-tools)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAZCAYAAAB3oa15AAACTElEQVR4Xu2XS6hNURjH/1yPvCN5DDyiKIMbAwNl4IqSVynyiExcZmRyJSlRt64B3VvidjNQJl5JJGVgIjKSZEDJhJKJuEWS+P99a9+9znf2PnufOzl7cH71q72+7ztrr/1Ya+0DtKkeM+gbH2wBL+kkHyxiDH1Iz7h4K7hCb8PGVJpT9CMd5xMtYBr9Rg/4RB7H6XfYD6vCEvqbHvGJLF7RWz5YAZ4GC/lLT/hgBeiHPYVCdAEbfLACHISNrRAVzfLBwFnY8jqWXqef6Bq6mQ7T02lpQ3bTO3Qi7Hwzo5zaz6J2QieauAAN0LOWvo7a55F2qP1Cx/vSdC5aDlU/n3bQX7CbkqB+eqN2wkKUvICvPhDYS9dF7cdIO9xGd6DcWr0Y6QD1ql5NU/9Rn3qinukoeQFlJsoU+pO+94kmuUa7orZugM6v/j2zUfICVKTH65lKD4XjS7C6PWkah+nkqF3EetQPSHtQj4slrEZ9fSYq0vvuSV4Z3aUP4XhpyC2j98OxmEOf0BdRzLMd9QO6R1e5WIImvq/PREVHfZC8pe9oN30Eq9tCV8AGq90yYX/INzrhAlheE1k3ZSC08+hD4/wI+nj6Qsf7xCjY5AMBrXIrUfvKXUT+AFWvz5uTPpHFcvqH7vSJUXDOBwIXYIO9Edp6ZX/QoZGKWrbCltu5PpGHNpkHPtgkWtv1RZvFTdgmuBF2o7R0X6YT4qKI57CNszSLYJ1mTeayDKJ+jU+YR+/CBqY/LLtq0zVopfsMmzNNc8wHWoCW5zZt2hTwD2XOb0WhJQIUAAAAAElFTkSuQmCC>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAaCAYAAAC3g3x9AAAAzUlEQVR4XmNgGAWjYJiDSUB8DohPA3EfEHsC8VEgPgnEXUjqiALsDBBDGIFYAIivA/FBIJYG4gYg/g9XSSRoQGJzAPFPJH4uEBsj8UFAFIhd0cRwAmcG3C4SYYD4ZBYQR6PJ4QQ9DLgNhAFhII5DF0QG8gwQr4LAZQZUA0Hhm4nEBwG8BoIMAxnAA8QLgHgnEL+DyvlD+TDLYEAQiGPQxFBAOgMkufgwQGK6ggFiUC8DJNzQAciF8eiClACaGJiALkgJABmYiC44CkYKAABmnh0n46uSHQAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAbCAYAAABxwd+fAAABAElEQVR4XmNgGAWjYBACNiA+DsS7gdgUSdwaiO8BsReSGF4wE4i5gPg/EK9CEp8BFSPKIFUgPgbEVgwQTcuQ5K4C8W8g5kESwwmCoHgyA8QgJyQ5EB/kZRgwAeIFQMyMJIYBXgLxXSBmRBIDGdQMZVsA8VaoGAtcBRYAUhCOJvYViDmQ+CkMRBpkhsRXAeItSHwQINqgdChbDYgvAnEOQhoMkhmIMKgdiH8B8VEgPgvEl4FYE0UFwkWsaOJwAAoH5EAGRTco8NEBQYM+A7EEEAsC8RQgfgPEHigqIABmEDu6BAzYA/FBIP4GxCuAWAFFFgJcgfgWAyJtgZLCKBjSAAAImzQiQR6dvQAAAABJRU5ErkJggg==>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAZCAYAAAAFbs/PAAAAhElEQVR4XmNgGAVDGrADcR8QMwKxABBfB+KDQCwNxA1A/B+uEgoq0fjHgdiYAaIBpBhDQwMSmwOIfyLxcxkgmnECZwYsJqIDeQaIySBwmQFVA8h/mUh8Bl4g/gjETkCsxgBRfBdJPgmIy5D4YNNBiniAeAEQ7wTid1A5fygfZvsoGKoAAIRuFczyYo5QAAAAAElFTkSuQmCC>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAbCAYAAACqenW9AAAAuUlEQVR4XmNgGAWDFnAB8TQgXgvEsmhyN4CYFVlgORAHA/F/IK5GlgCCJ8gcHSDeBmWDFJcjyWkC8VIkPkMYEHtB2SDFkkhymUCci8SHAxEg3o4mBnIeyGYMsBCIDZD4GgwQm7CCdUAsiMRPYcCjuBaInaFsfyB+xoBHMTcQ/wLiA0C8F4g/AfElZAUwwMOA6hELBuxhzsAExN+BeCcQy0Dpq0CsjKwIGbgB8XEGiNWTgJgPVXoUYAIAf9MgTlu7MgQAAAAASUVORK5CYII=>