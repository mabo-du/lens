# **Architectural Blueprint and Database Schema Optimization for a Local-First Qualitative Data Analysis Application**

The evolution of Computer-Assisted Qualitative Data Analysis Software (CAQDAS) is increasingly moving toward local-first, privacy-centric architectures. For researchers handling highly sensitive interview transcripts, archival documents, and proprietary field notes, data sovereignty is paramount. Desktop applications built on frameworks like Electron, backed by local SQLite databases (e.g., packaged within a .qdaproj file), provide an optimal balance of portability, offline availability, and robust relational querying capabilities.  
However, constructing an architecture capable of supporting complex qualitative methodologies—such as grounded theory or thematic analysis—requires sophisticated data modeling. Qualitative Data Analysis (QDA) environments demand hierarchical codebooks with unlimited nesting depth, highly overlapping inline text annotations, robust multimedia handling, and instantaneous full-text retrieval across large document corpora. The defined Minimum Viable Product (MVP) scope requires the system to maintain sub-millisecond query resolution when operating on projects containing over 200 transcripts and more than 5,000 distinct analytical annotations.  
This technical report delivers an exhaustive architectural strategy addressing hierarchical data storage, indexing optimization, full-text search implementation, transactional data safety, deployment-safe schema migrations, and interoperability standards required for future-proofing the application.

## **1\. Hierarchical Code Tree Storage Models in SQLite**

The qualitative codebook is the epistemological core of any QDA project. Researchers dynamically construct, modify, and reorganize hierarchical taxonomies of codes as their analytical understanding evolves. Consequently, the data model must flawlessly support nodes at arbitrary depths while balancing the performance costs of reading and mutating the tree structure. In relational database management systems, three predominant paradigms govern hierarchical storage: the Adjacency List, the Nested Set Model, and the Closure Table.

### **1.1 The Adjacency List Model**

The Adjacency List model is the most intuitive implementation, relying on a simple parent\_id foreign key referencing the primary key of the same table. It requires minimal storage and allows ![][image1] complexity for inserting new nodes or moving individual nodes. Historically, retrieving a full subtree in this model was computationally expensive, requiring multiple round-trips to the database. However, modern SQLite engines support Recursive Common Table Expressions (CTEs), which allow the query planner to traverse the tree in a single execution.1  
**Operation A: Render the full tree on app load**  
Rendering the entire tree is trivial, as the application only needs to load all rows and reconstruct the tree in memory.

SQL  
SELECT id, parent\_id, name, color, description   
FROM Code   
WHERE project\_id \=?;

**Operation B: Move a subtree to a new parent**  
Moving a node (which implicitly moves all its descendants) requires updating a single scalar value.

SQL  
UPDATE Code   
SET parent\_id \= 'new\_parent\_id'   
WHERE id \= 'moving\_node\_id';

**Operation C: Retrieve all codes in a subtree for query filtering** To find all descendant codes (e.g., to query all text annotated with "Emotion" or any of its sub-codes), a Recursive CTE must be dynamically constructed.1

SQL  
WITH RECURSIVE CodeSubtree AS (  
    SELECT id, parent\_id   
    FROM Code   
    WHERE id \= 'target\_ancestor\_id'  
      
    UNION ALL  
      
    SELECT c.id, c.parent\_id   
    FROM Code c  
    INNER JOIN CodeSubtree cs ON c.parent\_id \= cs.id  
)  
SELECT id FROM CodeSubtree;

*Analysis:* While conceptually simple, using Recursive CTEs within deeply nested JOIN clauses for the primary annotation retrieval query can overwhelm the SQLite query planner. In complex analytical queries combining FTS, co-occurrence, and hierarchical filtering, the planner may fail to utilize optimal indexes, resulting in catastrophic full-table scans. Furthermore, some developers harbor skepticism regarding the reliance on recursive logic for core, high-frequency application pathways.2

### **1.2 The Nested Set Model (Celko Model)**

The Nested Set Model, formalized by Joe Celko, encodes the hierarchy using a Modified Preorder Tree Traversal logic.3 Each node is assigned a lft and rgt integer value. A node is considered a descendant of another node if its lft and rgt values fall strictly between the lft and rgt bounds of the ancestor. This model guarantees ![][image1] complexity for retrieving subtrees, completely eliminating recursion.3  
**Operation A: Render the full tree on app load** The tree is retrieved and inherently sorted by the lft boundary, allowing sequential rendering.4

SQL  
SELECT id, name, lft, rgt   
FROM Code   
WHERE project\_id \=?   
ORDER BY lft ASC;

**Operation B: Move a subtree to a new parent** The fatal flaw of the Nested Set Model in a highly mutable QDA environment is the massive write penalty.3 Moving a subtree requires recalculating the lft and rgt boundaries for potentially every node in the entire codebook. The SQL required to move a subtree in a single atomic update relies on dense mathematical logic and complex CASE statements.6

SQL  
\-- Parameters:   
\-- @l: lft of the moving subtree  
\-- @r: rgt of the moving subtree  
\-- @p: target position (lft or rgt of the new parent depending on insertion logic)  
UPDATE Code SET   
  lft \= lft \+ CASE   
    WHEN @p \> @r THEN   
      CASE WHEN @r \< lft AND lft \< @p THEN @l \- @r \- 1  
           WHEN @l \<= lft AND lft \< @r THEN @p \- @r \- 1 ELSE 0 END  
    WHEN @p \<= lft AND lft \< @l THEN @r \- @l \+ 1  
    WHEN @l \<= lft AND lft \< @r THEN @p \- @l ELSE 0 END,  
  rgt \= rgt \+ CASE   
    WHEN @p \> @r THEN   
      CASE WHEN @r \< rgt AND rgt \< @p THEN @l \- @r \- 1  
           WHEN @l \< rgt AND rgt \<= @r THEN @p \- @r \- 1 ELSE 0 END  
    WHEN @p \<= rgt AND rgt \< @l THEN @r \- @l \+ 1  
    WHEN @l \< rgt AND rgt \<= @r THEN @p \- @l ELSE 0 END  
WHERE @r \< @p OR @p \< @l;

**Operation C: Retrieve all codes in a subtree for query filtering**  
Retrieval is exceptionally fast, requiring only a simple range query.

SQL  
SELECT descendant.id   
FROM Code AS descendant, Code AS ancestor   
WHERE ancestor.id \= 'target\_ancestor\_id'   
  AND descendant.lft BETWEEN ancestor.lft AND ancestor.rgt;

*Analysis:* While read performance is unmatched, QDA users frequently refactor their codebooks during the axial coding phase of grounded theory analysis. The immense locking overhead and risk of widespread corruption if the mathematical updates fail make Nested Sets a precarious choice for desktop software operating without robust DBA oversight.3

### **1.3 The Closure Table Model**

The Closure Table (or Transitive Closure) model isolates the hierarchical structure into a secondary table, mapping every ancestor to every descendant it possesses, along with the depth of separation.1 This represents a space-for-time tradeoff, demanding more storage but permitting mathematically simple, non-recursive ![][image1] subtree lookups.2  
In a QDA application, retaining a standard parent\_id in the primary Code table while maintaining a secondary CodePath table provides the ultimate hybrid approach, yielding simple UI rendering and rapid relational queries.1  
**Operation A: Render the full tree on app load**  
Rendering utilizes the simple Adjacency List logic stored in the primary table.

SQL  
SELECT id, parent\_id, name, color FROM Code WHERE project\_id \=?;

**Operation B: Move a subtree to a new parent** Moving a subtree involves severing the transitive connections to the old ancestry and cross-joining the moving subtree with the new ancestry.9 This requires a dedicated transaction.

SQL  
BEGIN TRANSACTION;

\-- 1\. Update immediate parent for standard UI rendering  
UPDATE Code SET parent\_id \= 'new\_parent\_id' WHERE id \= 'moving\_node\_id';

\-- 2\. Delete outdated paths crossing the moving node's boundary  
DELETE FROM CodePath   
WHERE descendant\_id IN (  
    SELECT descendant\_id FROM CodePath WHERE ancestor\_id \= 'moving\_node\_id'  
)  
AND ancestor\_id NOT IN (  
    SELECT descendant\_id FROM CodePath WHERE ancestor\_id \= 'moving\_node\_id'  
);

\-- 3\. Insert new transitive paths by cross-joining new ancestors with moving descendants  
INSERT INTO CodePath (ancestor\_id, descendant\_id, depth)  
SELECT   
    supertree.ancestor\_id,   
    subtree.descendant\_id,   
    supertree.depth \+ subtree.depth \+ 1  
FROM CodePath AS supertree  
CROSS JOIN CodePath AS subtree  
WHERE supertree.descendant\_id \= 'new\_parent\_id'  
  AND subtree.ancestor\_id \= 'moving\_node\_id';

COMMIT;

**Operation C: Retrieve all codes in a subtree for query filtering** Fetching descendants is a highly optimized index lookup.2

SQL  
SELECT descendant\_id   
FROM CodePath   
WHERE ancestor\_id \= 'target\_ancestor\_id';

### **1.4 Hierarchical Model Recommendation**

| Architectural Feature | Adjacency List | Nested Sets | Closure Table |
| :---- | :---- | :---- | :---- |
| **Schema Complexity** | Low | Low (Single Table) | Medium (Two Tables) |
| **Write Penalty** | Minimal | Severe (![][image2] index updates) | Moderate |
| **Subtree Retrieval** | Recursive CTE Overhead | ![][image1] Range Scan | ![][image1] Direct Join |
| **Query Planner Reliability** | Poor on complex queries | Excellent | Excellent |
| **Data Integrity Risk** | Low | High (Calculation drift) | Low |

For an MVP QDA architecture expecting dense, rapid analytical querying across a codebook of 500+ nodes, the **Closure Table** provides the most resilient foundation. The ability to execute subqueries directly against the CodePath table without modifying the outer SQL logic is invaluable for complex filtering scenarios.2 Furthermore, creating an ancestor table allows for simplified aggregate analytics, such as dynamically counting the total number of annotations present under a parent code category.

## **2\. Annotation Query Patterns and Indexing Strategy**

In standard textual analysis, annotations are defined by structural coordinates—specifically, a start\_char and end\_char integer offset corresponding to the document's plain text string. The efficiency of a CAQDAS tool is determined by its ability to resolve massive overlapping intervals across thousands of documents instantaneously.

### **2.1 The "Code View" Architecture**

The most critical operational pathway is the "Code View," where a researcher selects a specific code and requests all corresponding text segments from the entire corpus. For a project with 5,000 annotations across 200 documents, a full table scan is unacceptable.  
**Optimal SQL Implementation:**

SQL  
SELECT   
    a.id AS annotation\_id,  
    a.start\_char,  
    a.end\_char,  
    a.memo,  
    d.title AS document\_title,  
    \-- Extract the exact segment using SQLite's substr function  
    substr(d.plain\_text, a.start\_char \+ 1, a.end\_char \- a.start\_char) AS exact\_segment  
FROM Annotation a  
JOIN Document d ON a.document\_id \= d.id  
JOIN CodePath cp ON a.code\_id \= cp.descendant\_id  
WHERE cp.ancestor\_id \=?  
ORDER BY d.title ASC, a.start\_char ASC;

*(Note: SQLite's substr function is 1-indexed, meaning string manipulation must account for the offset accordingly).*  
**Indexing Requirements:**  
To ensure this query executes purely via index traversal, the schema demands targeted B-Tree structures.

1. CREATE INDEX idx\_codepath\_ancestor ON CodePath(ancestor\_id, descendant\_id);  
   This is a covering index. The query planner will traverse the B-Tree to find the ancestor\_id, and immediately extract the descendant\_id from the index node without referencing the actual table structure.  
2. CREATE INDEX idx\_annotation\_code ON Annotation(code\_id);  
   Once the descendant codes are resolved, this index allows the engine to instantly locate the relevant row IDs in the Annotation table.  
3. The primary keys for Document.id inherently provide clustered indexing for the document join.

### **2.2 Retrieving Annotations by Character Range (UI Rendering)**

When a user opens a transcript, the interface must dynamically render colored highlights over the text based on existing annotations. Furthermore, when a user selects a range of text, the system must immediately identify if any existing annotations overlap the selection.  
Overlap detection mathematically requires satisfying two inequalities simultaneously: Annotation.start\_char \< Selection.end\_char AND Annotation.end\_char \> Selection.start\_char.  
Traditional B-Tree indexes face a fundamental limitation when handling multiple range inequalities. The B-Tree can only traverse sequentially along a single axis; once it hits the first inequality, it must linearly scan all subsequent nodes that satisfy the first condition to check the second condition against them.13  
SQLite provides a dedicated rtree virtual table extension explicitly engineered for multidimensional spatial querying and overlapping range intervals.14 The R-Tree conceptually groups intervals into intersecting bounding boxes, allowing the query engine to rapidly discard irrelevant data chunks.16

SQL  
\-- The R\*Tree must be enabled during compilation via SQLITE\_ENABLE\_RTREE   
CREATE VIRTUAL TABLE AnnotationRangeIndex USING rtree(  
    id,              \-- Integer primary key mapping to Annotation.id  
    start\_char,      \-- Minimum coordinate  
    end\_char         \-- Maximum coordinate  
);

\-- Overlap Query  
SELECT a.\* FROM Annotation a  
JOIN AnnotationRangeIndex idx ON a.id \= idx.id  
WHERE idx.end\_char \>=? AND idx.start\_char \<=?;

**Architectural Caveat:** Standard SQLite R-Trees cast all coordinates to 32-bit single-precision floating-point numbers.16 While 32-bit floats provide roughly 7 significant decimal digits of precision (sufficient for up to 16.7 million character offsets without roundoff error), extremely long text corpora could theoretically trigger precision loss.16 Although SQLite 3.24.0 introduced integer-valued R-Trees (rtree\_i32) 16, managing virtual shadow tables introduces sync overhead.  
For an MVP capped at 200 transcripts of standard length (e.g., 50,000 words), an optimized composite B-Tree remains highly performant and eliminates the operational complexity of virtual tables. By placing the discrete document identifier before the continuous character ranges in the index, the B-Tree scopes the search strictly to a single text file.17  
**B-Tree Fallback Index:**

SQL  
CREATE INDEX idx\_annotation\_doc\_range ON Annotation(document\_id, start\_char, end\_char);

### **2.3 Code Co-Occurrence Queries**

Co-occurrence analytics power the methodological process of axial coding, where researchers examine the relationships and overlapping contexts between disparate conceptual categories. Calculating this requires a complex self-join on the Annotation table.13  
**Optimal SQL for Co-Occurrence:**

SQL  
SELECT   
    a1.code\_id AS code\_a,   
    a2.code\_id AS code\_b,   
    COUNT(\*) AS co\_occurrence\_count  
FROM Annotation a1  
JOIN Annotation a2   
  ON a1.document\_id \= a2.document\_id  
  AND a1.id \< a2.id \-- Prevents duplicated mirror pairs and self-matches  
  AND a1.start\_char \<= a2.end\_char   
  AND a1.end\_char \>= a2.start\_char  
GROUP BY a1.code\_id, a2.code\_id  
ORDER BY co\_occurrence\_count DESC;

**EXPLAIN QUERY PLAN Output Analysis:**  
Understanding how the SQLite Virtual Machine executes this query dictates the necessity of the idx\_annotation\_doc\_range index. If evaluated, the EXPLAIN QUERY PLAN would return:  
QUERY PLAN  
|--SCAN TABLE Annotation AS a1  
|--SEARCH TABLE Annotation AS a2 USING INDEX idx\_annotation\_doc\_range (document\_id=?)  
|--USE TEMP B-TREE FOR GROUP BY  
\`--USE TEMP B-TREE FOR ORDER BY  
The planner performs a full scan of the outer table (a1), but utilizes the idx\_annotation\_doc\_range index to rapidly locate potential intersecting partners in a2. Because the equality constraint (document\_id=?) constitutes the left-most column of the index, SQLite performs a rapid binary search to locate the specific document block.13 Following the equality check, the engine utilizes the inequalities to sequentially scan only the localized, relevant index nodes, vastly outperforming a nested full-table scan.13

## **3\. SQLite FTS5 for Full-Text Search Implementation**

Retrieving specific keywords across hundreds of thousands of words is a foundational QDA requirement. The architectural choice lies between embedding an external Javascript search library within the Node/Electron process or leveraging SQLite's native FTS5 engine.

### **3.1 JavaScript Search Libraries vs SQLite FTS5**

Libraries such as FlexSearch, Lunr.js, and MiniSearch are highly optimized JavaScript tools that generate inverted indices stored in memory or serialized into IndexedDB architectures.23 While index compilation is remarkably fast, these libraries introduce systemic liabilities within an Electron desktop application operating on large corpora.  
To utilize a JS search library, the entire text corpus must be serialized, transferred across the Inter-Process Communication (IPC) bridge from the main Node process to the renderer process, and loaded into V8's heap memory.23 For a 200-document database, this mandates allocating hundreds of megabytes of RAM exclusively to search indexing upon every application launch. This heavy memory footprint triggers aggressive garbage collection cycles, causing UI stuttering and potentially crashing the process if heap limits are exceeded. Furthermore, any changes to the database (adding new annotations, modifying transcripts) require manual, asynchronous resynchronization of the in-memory index.23  
Conversely, SQLite FTS5 operates strictly at the C-level, circumventing Node.js entirely during index traversal. FTS5 stores its inverted index in immutable segment B-trees directly within the .qdaproj file structure.17 When queried, SQLite merges these segment B-trees and returns only the highly optimized scalar results to the JS process.17 FTS5 supports Boolean operators (AND, OR, NOT), prefix matching (\*), and proximity/phrase search (NEAR) natively.17 Memory overhead is virtually zero, and startup costs are eliminated since the index is persistently serialized to disk.

| Feature Comparison | Node.js Libraries (e.g., FlexSearch) | SQLite Native FTS5 |
| :---- | :---- | :---- |
| **Index Persistence** | In-memory (High RAM) or IndexedDB (Slow) | On-disk (Segment B-Trees) |
| **Startup Overhead** | High (Must rebuild or deserialize index) | Zero (Persistent disk state) |
| **Memory Architecture** | Pollutes V8 Heap | Zero-copy C-level memory maps |
| **Consistency Control** | Vulnerable to desync during mutations | Strictly enforced via DB Triggers |
| **Complex Operators** | Basic (Library dependent) | Advanced (MATCH '"phrase" NEAR/3 term') |

### **3.2 FTS5 External Content Schema and Triggers**

To prevent duplicating the massive plain\_text strings of the documents—which would bloat the .qdaproj file size unnecessarily—FTS5 must be configured as an "external content" virtual table.25 In this architecture, FTS5 maintains the term-to-rowid inverted indices but defers back to the primary Document table to retrieve the actual textual payloads when queried.25

SQL  
CREATE VIRTUAL TABLE DocumentFTS USING fts5(  
    title,   
    plain\_text,   
    content\='Document',   
    content\_rowid\='id',   
    tokenize\='unicode61 remove\_diacritics 1'  
);

External content tables do not automatically detect mutations in the parent table. Therefore, rigorous database triggers must be instantiated to guarantee that any INSERT, UPDATE, or DELETE executed against the Document table is instantaneously reflected in the FTS5 index.17

SQL  
\-- Fired upon importing a new document  
CREATE TRIGGER tbl\_Document\_ai AFTER INSERT ON Document BEGIN  
  INSERT INTO DocumentFTS(rowid, title, plain\_text)   
  VALUES (new.id, new.title, new.plain\_text);  
END;

\-- Fired upon deleting a document  
CREATE TRIGGER tbl\_Document\_ad AFTER DELETE ON Document BEGIN  
  INSERT INTO DocumentFTS(DocumentFTS, rowid, title, plain\_text)   
  VALUES('delete', old.id, old.title, old.plain\_text);  
END;

\-- Fired upon modifying an existing document  
CREATE TRIGGER tbl\_Document\_au AFTER UPDATE ON Document BEGIN  
  INSERT INTO DocumentFTS(DocumentFTS, rowid, title, plain\_text)   
  VALUES('delete', old.id, old.title, old.plain\_text);  
  INSERT INTO DocumentFTS(rowid, title, plain\_text)   
  VALUES (new.id, new.title, new.plain\_text);  
END;

**Query Execution Pattern:** To execute a search, the application queries the virtual table utilizing the specialized MATCH operator. FTS5 automatically ranks the results by relevance using the BM25 algorithm.17

SQL  
SELECT d.id, d.title, snippet(DocumentFTS, 1, '\<b\>', '\</b\>', '...', 64) AS context  
FROM DocumentFTS fts  
JOIN Document d ON fts.rowid \= d.id  
WHERE DocumentFTS MATCH 'search AND "exact phrase"'  
ORDER BY rank;

### **3.3 The CJK Tokenization Conundrum**

A profound limitation of SQLite's native FTS5 engine is its default mechanism for handling non-Latin language scripts.17 The default unicode61 tokenizer correctly segments words based on Unicode-defined whitespace and punctuation boundaries, and effectively strips diacritics for Latin alphabets.17  
However, continuous-script languages characteristic of Chinese, Japanese, and Korean (CJK) do not utilize spaces between words. When unicode61 ingests a string of Chinese characters, it perceives the entire unspaced sentence as a single, monolithic token.28 Consequently, searching for a specific Chinese word within that sentence will yield zero results, drastically impairing usability for international researchers.28  
For highly targeted regional builds, compiling a custom C++ International Components for Unicode (ICU) tokenizer or integrating a segmentation bridge (such as cppjieba for Chinese) provides optimal semantic fidelity.28 However, integrating custom C++ extensions into an Electron build pipeline is notoriously fragile.31  
The robust, cross-platform mitigation strategy natively supported by SQLite is the trigram tokenizer.17 Instead of attempting semantic word segmentation, the trigram tokenizer extracts every contiguous sequence of three characters. While this increases the disk footprint of the FTS index, it allows FTS5 to perform general substring matching irrespective of language or spacing rules.17 For an open-source tool demanding universal compatibility out of the box, offering a user-toggleable option to construct the FTS table using tokenize='trigram' for CJK-heavy projects is highly recommended.

## **4\. WAL Mode, Transactions, and Data Safety**

Qualitative research involves hundreds of hours of manual, irreplaceable analytical labor. An application crash or a localized power failure that results in SQLite database corruption is an existential threat to the software's adoption. By default, SQLite is configured for maximal backward compatibility, utilizing legacy journaling systems that do not offer optimal concurrent performance or crash resilience under modern desktop paradigms.33

### **4.1 Write-Ahead Logging vs Rollback Journals**

The traditional Rollback Journal (journal\_mode=DELETE) operates by modifying the primary database file directly while simultaneously generating a secondary journal file containing the original state data, which is used to revert changes if a transaction aborts.34 This architecture demands intense disk I/O and creates strict blocking locks, preventing readers from accessing the database while a writer is executing.  
Write-Ahead Logging (journal\_mode=WAL) fundamentally reverses this workflow.33 Under WAL mode, the original database file is left untouched during write operations. Instead, new transactions are sequentially appended to a .wal file.33 When the application requests data, SQLite seamlessly merges the state of the pristine main database with the delta modifications present in the .wal file.33 This mechanism allows readers and writers to operate concurrently without blocking one another, drastically improving perceived UI performance.

### **4.2 Synchronous Settings and Atomicity**

The safety of WAL mode relies entirely on the PRAGMA synchronous configuration, which dictates exactly when the SQLite engine invokes the operating system's fsync() command to force hardware buffers to flush their contents to physical, non-volatile disk surfaces.32

* **OFF (0):** SQLite hands data off to the operating system and continues execution immediately.32 While blazingly fast, if the operating system crashes or the computer loses power before the OS executes the flush, the database faces a high risk of catastrophic corruption.32  
* **FULL (2):** SQLite pauses execution and forces the hardware to sync the WAL file to disk upon every single commit.32 This guarantees 100% ACID compliance and absolute zero data loss, but the continuous disk I/O severely degrades bulk write performance.32  
* **NORMAL (1):** The engine syncs the data only during critical WAL checkpointing operations.32

For a desktop QDA application running in Electron, **PRAGMA journal\_mode=WAL combined with PRAGMA synchronous=NORMAL** is the definitive optimal configuration.32 In this paradigm, SQLite maintains strict structural consistency.32 If the Electron application crashes (e.g., a V8 memory leak or a main process fatal error), the data safely resides within the OS disk buffer and will be written successfully, guaranteeing absolute data survival.  
In the statistically rare event of a total hard power loss (e.g., the computer is unplugged), the NORMAL setting ensures the database file remains entirely uncorrupted.32 The only penalty is a temporary loss of *durability*—the single most recent uncheckpointed transaction might be rolled back.32 To a qualitative researcher, losing the last three seconds of annotation work is an acceptable annoyance; losing a fully corrupted project file is a disaster.

### **4.3 Checkpointing and Bulk Imports**

The .wal file grows indefinitely as new writes occur. To prevent the file from consuming excessive disk space and slowing down read operations, SQLite periodically executes a checkpoint, transferring the modifications from the WAL file back into the primary database.32 By default, SQLite initiates a PASSIVE automatic checkpoint (PRAGMA wal\_autocheckpoint) whenever the WAL file exceeds 1,000 pages.32  
However, during massive bulk operations—such as importing a 50,000-word transcript, generating base structural codes, and triggering the FTS5 tokenization sequence—relying on implicit commits and automatic checkpoints is disastrous. Executing a FOR loop that inserts thousands of individual annotations will trigger thousands of micro-commits, overwhelming the I/O pipeline and fragmenting the WAL.34  
A crash-safe bulk import architecture mandates wrapping the entire sequence in an explicit atomic transaction.34  
**Bulk Import Transaction Wrapper:**

JavaScript  
function importDocumentData(db, document, structuralAnnotations) {  
  // Execute PRAGMA wal\_checkpoint(RESTART) prior to massive ingestion  
  // to clear the WAL and optimize contiguous write space   
  db.pragma('wal\_checkpoint(RESTART)');  
    
  // Create a prepared transaction utilizing the better-sqlite3 wrapper  
  const executeImport \= db.transaction((doc, annotations) \=\> {  
    // 1\. Insert Document (Automatically triggers FTS5 indexing via SQLite triggers)  
    db.prepare(\`INSERT INTO Document (id, title, plain\_text) VALUES (?,?,?)\`).run(doc.id, doc.title, doc.text);  
      
    // 2\. Iterate and execute bulk annotation inserts utilizing prepared statements  
    const insertAnnotation \= db.prepare(\`INSERT INTO Annotation (id, document\_id, start\_char, end\_char) VALUES (?,?,?,?)\`);  
    for (const ann of annotations) {  
      insertAnnotation.run(ann.id, doc.id, ann.start, ann.end);  
    }  
  });

  // Execute atomically  
  executeImport(document, structuralAnnotations);  
}

By encapsulating the import within a transaction, SQLite guarantees atomic integrity. If the application crashes midway through processing the 50,000 words, the entire transaction is discarded, leaving the database perfectly clean rather than polluted with partial document fragments.

## **5\. Schema Migrations in Distributed Electron Environments**

Unlike centralized cloud SaaS platforms where a dedicated Database Administrator manages strict deployment pipelines, desktop software exists in a highly decentralized state. A user might operate offline for a year, deciding to upgrade from v1.0 directly to v4.0, entirely bypassing versions 2.0 and 3.0. The migration architecture must handle these temporal leaps seamlessly, automatically resolving schema deficits without user intervention.

### **5.1 Node.js Migration Libraries vs Embedded SQL**

Many Node.js developers instinctively reach for sophisticated ORMs and query builders (e.g., Knex, Drizzle ORM, Kysely, Sequelize) to manage schema migrations. While appropriate for server environments, these libraries introduce crippling liabilities in Electron desktop applications:

1. **Build Chain Fragility:** Utilizing native SQLite drivers like better-sqlite3 requires complex node-gyp recompilation against specific Electron C++ header binaries.31 Abstracting the database layer behind a heavy ORM exponentially complicates this build pipeline and creates cross-platform compatibility nightmares.  
2. **Runtime Distribution Complexity:** ORM migration systems typically rely on dynamic file system scanning to locate and parse .js migration scripts. When an Electron application is packaged for production, the source code is compressed into a read-only ASAR archive. This effectively breaks the dynamic path resolution upon which ORM migrators depend, causing startup failures.

For robust, offline-first applications, **embedding pure SQL strings executed synchronously upon startup, tracked by SQLite's native user\_version PRAGMA**, provides unparalleled reliability.38

### **5.2 The Deterministic Startup Migration Loop**

The PRAGMA user\_version is an arbitrary integer stored directly within the SQLite file header.38 It acts as a permanent, embedded state machine flag, distinctly identifying the schema's architectural epoch regardless of the application's software version.  
Migrations must be executed synchronously during the Electron main process startup sequence, strictly before the application is permitted to mount its UI renderer or accept user input. The payload consists of an array of immutable SQL ALTER and CREATE strings, where the array index strictly correlates to the targeted user\_version.  
**Migration Loop Implementation:**

JavaScript  
const migrations \=;

function applySchemaMigrations(db) {  
  // Retrieve the current schema state directly from the binary header  
  let currentVersion \= db.pragma('user\_version', { simple: true });  
  const targetVersion \= migrations.length;

  if (currentVersion \=== targetVersion) return; // Schema is identical to app expectation

  // Encapsulate the entire migration cascade within an atomic transaction  
  const runMigration \= db.transaction(() \=\> {  
    while (currentVersion \< targetVersion) {  
      // Execute the required specific schema mutation  
      db.exec(migrations\[currentVersion\]);  
        
      // Increment state flag  
      currentVersion++;  
        
      // Write the new state flag directly back to the SQLite header  
      db.pragma(\`user\_version \= ${currentVersion}\`);  
    }  
  });

  runMigration();   
}

This linear state-machine approach guarantees deterministic execution. If a user skips updates, the while loop sequentially processes the exact mathematical difference of the schema debt, running the required ALTER statements atomically to guarantee that structural integrity is preserved.

## **6\. Proposed Schema Extensions for v2+ Roadmap and REFI-QDA Compliance**

To minimize the necessity of highly destructive migrations later in the product's lifecycle, the foundational MVP schema must proactively accommodate the specific structural demands of the v2+ roadmap. The application must eventually support image region bounding boxes, audio/video timestamp coding, and rigorous interoperability compliance with the REFI-QDA XML project exchange standard (.qdpx).42

### **6.1 REFI-QDA Standard Constraints**

The Rotterdam Exchange Format Initiative (REFI) .qdpx standard was engineered to allow qualitative data to flow seamlessly between competing software platforms such as ATLAS.ti, MAXQDA, and NVivo.44 The standard dictates extremely strict validation schemas.42  
The defining mandate of REFI-QDA is the absolute requirement of Universally Unique Identifiers (GUIDs) for every distinct analytical entity.42 Utilizing standard auto-incrementing integers (INTEGER PRIMARY KEY) for database rows guarantees severe primary key collisions when a researcher attempts to import a project from a collaborator. Therefore, the schema must enforce UUIDv4 strings for all id definitions from its inception.42  
Additionally, REFI requires the hierarchical grouping of files and metadata into "Cases" and "Sets".43 A Case represents an independent analytical unit (e.g., "Participant 12") that links specific demographic variables (e.g., Age, Occupation) to multiple distinct documents (e.g., an interview transcript, a photograph, and a field note).44

### **6.2 Multimedia Extensions and Polymorphism**

The MVP Annotation model utilizes start\_char and end\_char integers.1 Expanding this to support multimedia requires tracking duration offsets (start\_ms, end\_ms) for audio and spatial geometry strings for images.1 Creating disparate tables for TextAnnotation, VideoAnnotation, and ImageAnnotation introduces crushing query complexity, requiring dense UNION ALL statements to generate aggregate statistics or render unified code views.  
The optimal strategy involves drafting the Annotation table as a wide, polymorphic entity. Columns not relevant to the specific media type mapped to the parent document are explicitly set to NULL.

### **6.3 Forward-Compatible Schema Definitions**

The following DDL establishes the robust v2+ foundation, satisfying REFI-QDA structural demands while perfectly supporting the v1 textual architecture.42

SQL  
\-- REFI-QDA Case Grouping Entity   
CREATE TABLE CaseGroup (  
    id TEXT PRIMARY KEY, \-- Enforced UUIDv4   
    project\_id TEXT NOT NULL,  
    name TEXT NOT NULL,  
    description TEXT,  
    created\_at DATETIME DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY(project\_id) REFERENCES Project(id) ON DELETE CASCADE  
);

\-- REFI-QDA Case Variables mapping demographic values \[44, 48\]  
CREATE TABLE CaseVariable (  
    id TEXT PRIMARY KEY,  
    project\_id TEXT NOT NULL,  
    name TEXT NOT NULL,  
    value\_type TEXT NOT NULL, \-- Enum constraint: 'STRING', 'INTEGER', 'BOOLEAN'  
    FOREIGN KEY(project\_id) REFERENCES Project(id) ON DELETE CASCADE  
);

CREATE TABLE CaseVariableValue (  
    case\_id TEXT NOT NULL,  
    variable\_id TEXT NOT NULL,  
    value TEXT NOT NULL,  
    PRIMARY KEY (case\_id, variable\_id),  
    FOREIGN KEY(case\_id) REFERENCES CaseGroup(id) ON DELETE CASCADE,  
    FOREIGN KEY(variable\_id) REFERENCES CaseVariable(id) ON DELETE CASCADE  
);

\-- Upgraded Document representation  
CREATE TABLE Document (  
    id TEXT PRIMARY KEY,   
    project\_id TEXT NOT NULL,  
    title TEXT NOT NULL,  
    file\_path TEXT,  
    mime\_type TEXT NOT NULL, \-- Defines media parser: 'text/plain', 'audio/wav', 'image/jpeg' \[47\]  
    plain\_text TEXT,         \-- Nullable for pure A/V files without transcription  
    duration\_ms INTEGER,     \-- Future V2 requirement for temporal limits  
    imported\_at DATETIME DEFAULT CURRENT\_TIMESTAMP,  
    FOREIGN KEY(project\_id) REFERENCES Project(id) ON DELETE CASCADE  
);

\-- Polymorphic Annotation Schema bridging text, spatial, and temporal axes  
CREATE TABLE Annotation (  
    id TEXT PRIMARY KEY,   
    document\_id TEXT NOT NULL,  
    code\_id TEXT NOT NULL,  
      
    \-- Text bounds (MVP scope)  
    start\_char INTEGER NULL,  
    end\_char INTEGER NULL,  
      
    \-- Temporal bounds (Audio/Video support)  
    start\_ms INTEGER NULL,  
    end\_ms INTEGER NULL,  
      
    \-- Spatial bounds (Image mapping via SVG/GeoJSON string formats)  
    region\_polygon TEXT NULL,   
      
    memo TEXT,  
    created\_by TEXT,  
    created\_at DATETIME DEFAULT CURRENT\_TIMESTAMP,  
      
    FOREIGN KEY(document\_id) REFERENCES Document(id) ON DELETE CASCADE,  
    FOREIGN KEY(code\_id) REFERENCES Code(id) ON DELETE CASCADE,  
      
    \-- Structural constraint enforcing that at least one bound type is populated  
    CHECK (  
        (start\_char IS NOT NULL AND end\_char IS NOT NULL) OR   
        (start\_ms IS NOT NULL AND end\_ms IS NOT NULL) OR   
        (region\_polygon IS NOT NULL)  
    )  
);

By establishing these conceptual tables and polymorphic columns during the initial architecture phase—even if the UI interfaces required to manipulate audio or image polygons remain unimplemented—the core database is thoroughly immunized against structural regression when executing the v2 roadmap.

## **7\. Conclusions and Architectural Directives**

Constructing an offline-first qualitative analysis environment requires mitigating the inherent processing constraints of the SQLite/Electron stack through advanced relational methodology. The following architectural decisions represent the necessary minimum to ensure sub-millisecond querying and absolute data safety across dense corpora:

1. **Hierarchical Modeling:** The Closure Table is strictly superior to the Nested Sets and Adjacency List patterns for deeply nested QDA codebooks. It guarantees mathematically simple, highly optimized index traversals for subtree annotation retrieval without incurring the extreme mutation penalties associated with the Celko model.  
2. **Annotation Indexing:** Composite B-Tree indexes constructed identically to (document\_id, start\_char, end\_char) will sufficiently power UI rendering and advanced axial coding self-joins by allowing the query planner to rapidly isolate bounding regions before initiating sequential scans.  
3. **FTS Implementation:** SQLite's native FTS5 must be utilized over memory-intensive JavaScript alternatives. Establishing an external content virtual table powered by active triggers guarantees absolute synchronization with the primary document store while utilizing zero additional V8 heap memory during runtime.  
4. **Transaction Safety:** Operational integrity relies entirely on combining PRAGMA journal\_mode=WAL and PRAGMA synchronous=NORMAL. This mitigates the severe I/O bottlenecks of legacy journaling while guaranteeing the physical integrity of the SQLite file against catastrophic OS panics or Electron process terminations.  
5. **Schema Evolution:** Relying strictly on the user\_version binary header allows for deterministic, embedded SQL migration sequences on application startup. This entirely bypasses the build-chain vulnerabilities inherent in utilizing complex ORM libraries.  
6. **Interoperability:** By enforcing UUIDv4 primary keys globally and structuring a polymorphic annotation matrix, the schema is definitively anchored against the structural demands of future multimedia implementation and the complex entity associations dictated by the REFI-QDA interoperability standards.

#### **Works cited**

1. What is the most efficient way to parse a flat table into a tree? \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/192220/what-is-the-most-efficient-way-to-parse-a-flat-table-into-a-tree](https://stackoverflow.com/questions/192220/what-is-the-most-efficient-way-to-parse-a-flat-table-into-a-tree)  
2. Recursive CTE vs closure table for storing hierarchical information : r/PostgreSQL \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/PostgreSQL/comments/1777s0t/recursive\_cte\_vs\_closure\_table\_for\_storing/](https://www.reddit.com/r/PostgreSQL/comments/1777s0t/recursive_cte_vs_closure_table_for_storing/)  
3. Storing Hierarchical Data in Relational Databases with SQL \- Adam Djellouli, accessed June 15, 2026, [https://adamdjellouli.com/articles/databases\_notes/03\_sql/09\_hierarchical\_data](https://adamdjellouli.com/articles/databases_notes/03_sql/09_hierarchical_data)  
4. Part 1: Nested sets. The Nested Sets model is a way to… | by Serhii Samoilenko | Medium, accessed June 15, 2026, [https://medium.com/@serhiisamoilenko/part-1-nested-sets-239e70f59beb](https://medium.com/@serhiisamoilenko/part-1-nested-sets-239e70f59beb)  
5. How to improve poor performance with two joined CTE expressions on hierarchical data?, accessed June 15, 2026, [https://dba.stackexchange.com/questions/281851/how-to-improve-poor-performance-with-two-joined-cte-expressions-on-hierarchical](https://dba.stackexchange.com/questions/281851/how-to-improve-poor-performance-with-two-joined-cte-expressions-on-hierarchical)  
6. Move node in nested set \- mysql \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/889527/move-node-in-nested-set](https://stackoverflow.com/questions/889527/move-node-in-nested-set)  
7. Nested Sets: move subtree – SednaSoft | Softwareentwicklung in Görlitz, accessed June 15, 2026, [https://sedna-soft.de/articles/nested-sets-move-subtree/](https://sedna-soft.de/articles/nested-sets-move-subtree/)  
8. Move node in Nested Sets tree \- mysql \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/2801285/move-node-in-nested-sets-tree](https://stackoverflow.com/questions/2801285/move-node-in-nested-sets-tree)  
9. Planet MySQL \- Archives \- Moving Subtrees in Closure Table Hierarchies, accessed June 15, 2026, [https://planet.mysql.com/entry/?id=27321](https://planet.mysql.com/entry/?id=27321)  
10. Moving a transitive closure subtree with MySQL \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/28961295/moving-a-transitive-closure-subtree-with-mysql](https://stackoverflow.com/questions/28961295/moving-a-transitive-closure-subtree-with-mysql)  
11. hierarchy-data-closure-table/postgres/procedures/move\_subtree.sql at master \- GitHub, accessed June 15, 2026, [https://github.com/developerworks/hierarchy-data-closure-table/blob/master/postgres/procedures/move\_subtree.sql](https://github.com/developerworks/hierarchy-data-closure-table/blob/master/postgres/procedures/move_subtree.sql)  
12. Closure Table \- Fueled, accessed June 15, 2026, [https://fueled.com/blog/closure-table/](https://fueled.com/blog/closure-table/)  
13. Optimizing Sqlite self joins \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/59381556/optimizing-sqlite-self-joins](https://stackoverflow.com/questions/59381556/optimizing-sqlite-self-joins)  
14. The SQLite R\*Tree Module, accessed June 15, 2026, [https://borelly.net/cb/docs/sqlite-3.7.2/rtree.html](https://borelly.net/cb/docs/sqlite-3.7.2/rtree.html)  
15. SQLite and range query \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/32331597/sqlite-and-range-query](https://stackoverflow.com/questions/32331597/sqlite-and-range-query)  
16. The SQLite R\*Tree Module, accessed June 15, 2026, [https://www.sqlite.org/rtree.html](https://www.sqlite.org/rtree.html)  
17. SQLite FTS5 Extension, accessed June 15, 2026, [https://sqlite.org/fts5.html](https://sqlite.org/fts5.html)  
18. SQL query to get overlapping entries between two big lists of ranges \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/59955606/sql-query-to-get-overlapping-entries-between-two-big-lists-of-ranges](https://stackoverflow.com/questions/59955606/sql-query-to-get-overlapping-entries-between-two-big-lists-of-ranges)  
19. What is the difference between btree and rtree indexing?, accessed June 15, 2026, [https://softwareengineering.stackexchange.com/questions/113256/what-is-the-difference-between-btree-and-rtree-indexing](https://softwareengineering.stackexchange.com/questions/113256/what-is-the-difference-between-btree-and-rtree-indexing)  
20. SQLite Self-join \- Joining a Table to Itself, accessed June 15, 2026, [https://www.sqlitetutorial.net/sqlite-self-join/](https://www.sqlitetutorial.net/sqlite-self-join/)  
21. Query Planning \- SQLite, accessed June 15, 2026, [https://www.sqlite.org/queryplanner.html](https://www.sqlite.org/queryplanner.html)  
22. SQLite Query Optimisation — How the Planner Thinks and Where It Goes Wrong, accessed June 15, 2026, [https://gauravsarma1992.medium.com/you-write-a-query-against-a-table-with-500-000-rows-and-an-index-on-the-column-youre-filtering-by-5ff446fe03d2](https://gauravsarma1992.medium.com/you-write-a-query-against-a-table-with-500-000-rows-and-an-index-on-the-column-youre-filtering-by-5ff446fe03d2)  
23. With FlexSearch or lunr or similar, building an index is so fast for “thousands ... \- Hacker News, accessed June 15, 2026, [https://news.ycombinator.com/item?id=42539202](https://news.ycombinator.com/item?id=42539202)  
24. Making a full-text search module that works on both desktop and mobile (Pt. 1), accessed June 15, 2026, [https://dev.to/craftzdog/making-a-full-text-search-module-that-works-on-both-desktop-and-mobile-pt-1-1n9i](https://dev.to/craftzdog/making-a-full-text-search-module-that-works-on-both-desktop-and-mobile-pt-1-1n9i)  
25. SQLite FTS5 Extension, accessed June 15, 2026, [https://www2.sqlite.org/draft/matrix/fts5.html](https://www2.sqlite.org/draft/matrix/fts5.html)  
26. sqlite3 fts5 contentless or content=external table, how store and read a non-FTS column value \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/71748748/sqlite3-fts5-contentless-or-content-external-table-how-store-and-read-a-non-fts](https://stackoverflow.com/questions/71748748/sqlite3-fts5-contentless-or-content-external-table-how-store-and-read-a-non-fts)  
27. Unicode support for non-English characters with Sqlite Full Text Search in Android, accessed June 15, 2026, [https://stackoverflow.com/questions/29669342/unicode-support-for-non-english-characters-with-sqlite-full-text-search-in-andro](https://stackoverflow.com/questions/29669342/unicode-support-for-non-english-characters-with-sqlite-full-text-search-in-andro)  
28. How can I use FTS5 Tokenizers to search Chinese ? · Issue \#413 · groue/GRDB.swift, accessed June 15, 2026, [https://github.com/groue/GRDB.swift/issues/413](https://github.com/groue/GRDB.swift/issues/413)  
29. Why sqlite fts5 Unicode61 Tokenizer does not support CJK(Chinese Japanese Korean)? \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/52422437/why-sqlite-fts5-unicode61-tokenizer-does-not-support-cjkchinese-japanese-korean](https://stackoverflow.com/questions/52422437/why-sqlite-fts5-unicode61-tokenizer-does-not-support-cjkchinese-japanese-korean)  
30. Introducing: FTS5 ICU Tokenizer for Better Multilingual Text Search : r/sqlite \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/sqlite/comments/1nkaqiq/introducing\_fts5\_icu\_tokenizer\_for\_better/](https://www.reddit.com/r/sqlite/comments/1nkaqiq/introducing_fts5_icu_tokenizer_for_better/)  
31. Failed to build in Electron · Issue \#704 · WiseLibs/better-sqlite3 \- GitHub, accessed June 15, 2026, [https://github.com/WiseLibs/better-sqlite3/issues/704](https://github.com/WiseLibs/better-sqlite3/issues/704)  
32. Pragma statements supported by SQLite, accessed June 15, 2026, [https://sqlite.org/pragma.html](https://sqlite.org/pragma.html)  
33. Write-Ahead Logging \- SQLite, accessed June 15, 2026, [https://sqlite.org/wal.html](https://sqlite.org/wal.html)  
34. How safe is SQLite WAL on power failures? \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/3584530/how-safe-is-sqlite-wal-on-power-failures](https://stackoverflow.com/questions/3584530/how-safe-is-sqlite-wal-on-power-failures)  
35. A transaction committed in WAL mode with synchronous=NORMAL might roll back fo... | Hacker News, accessed June 15, 2026, [https://news.ycombinator.com/item?id=34260796](https://news.ycombinator.com/item?id=34260796)  
36. \[sqlite\] PRAGMA Synchronous safety, accessed June 15, 2026, [https://sqlite-users.sqlite.narkive.com/E0PV7xHv/sqlite-pragma-synchronous-safety](https://sqlite-users.sqlite.narkive.com/E0PV7xHv/sqlite-pragma-synchronous-safety)  
37. Balancing SQLite's WAL, SYNCHRONOUS=OFF, and fsync for fast rqlite recovery, accessed June 15, 2026, [https://philipotoole.com/rqlite-9-2-the-distributed-database-built-on-sqlite-fast-restarts-with-gb-datasets/](https://philipotoole.com/rqlite-9-2-the-distributed-database-built-on-sqlite-fast-restarts-with-gb-datasets/)  
38. How To Corrupt An SQLite Database File, accessed June 15, 2026, [https://sqlite.org/howtocorrupt.html](https://sqlite.org/howtocorrupt.html)  
39. Process vs OS level durability (sync=NORMAL, WAL) \- SQLite User Forum, accessed June 15, 2026, [https://sqlite.org/forum/info/9d6f13e346231916](https://sqlite.org/forum/info/9d6f13e346231916)  
40. Electron app cant find sqlite3 module \- Stack Overflow, accessed June 15, 2026, [https://stackoverflow.com/questions/38716594/electron-app-cant-find-sqlite3-module](https://stackoverflow.com/questions/38716594/electron-app-cant-find-sqlite3-module)  
41. electron \+ better-sqlite3 in an older project (NODE\_MODULE\_VERSION issue) \- Reddit, accessed June 15, 2026, [https://www.reddit.com/r/electronjs/comments/1dwukgy/electron\_bettersqlite3\_in\_an\_older\_project\_node/](https://www.reddit.com/r/electronjs/comments/1dwukgy/electron_bettersqlite3_in_an_older_project_node/)  
42. Project Implementation Files \- REFI-QDA, accessed June 15, 2026, [https://www.qdasoftware.org/project-implementation-files](https://www.qdasoftware.org/project-implementation-files)  
43. REFI-QDA Project, accessed June 15, 2026, [https://www.qdasoftware.org/project](https://www.qdasoftware.org/project)  
44. Export and Import REFI-QDA Projects \- maxqda, accessed June 15, 2026, [https://www.maxqda.com/help/report-and-export/export-and-import-refi-qda-projects](https://www.maxqda.com/help/report-and-export/export-and-import-refi-qda-projects)  
45. QDPX – The Universal Project Exchange Format for Qualitative Data \- ATLAS.ti, accessed June 15, 2026, [https://atlasti.com/features/project-export-in-qdpx-format](https://atlasti.com/features/project-export-in-qdpx-format)  
46. The REFI-QDA Standard, accessed June 15, 2026, [https://www.qdasoftware.org/](https://www.qdasoftware.org/)  
47. Formatting Data \- Qualitative Data Repository \- Syracuse University, accessed June 15, 2026, [https://qdr.syr.edu/guidance/managing/formatting-data](https://qdr.syr.edu/guidance/managing/formatting-data)  
48. Codebook Implementation Files \- REFI-QDA, accessed June 15, 2026, [https://www.qdasoftware.org/codebook-implementation-files](https://www.qdasoftware.org/codebook-implementation-files)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACsAAAAaCAYAAAAue6XIAAACIUlEQVR4Xu2WP0iVURjG3yIq+4uTS5a1VJDQktQk5GAQFBY5h4NIRDTYIFYogjUozYESREsRRTU0OBVBqUSQhkM1JaIkDTlJQz6P59zu8eF89zuB3yDcH/y493vec895L993z7lmVTYGt+EDDXPYDj/D81oomhm4U8OAkxp4GuFPeEwLRbEfXtLQsxVeNddQFsPwg4apdMHH5hb4C+fhmTUj1jIKN2to5c9+9++zOAT/wHNaqMQWeA3eh6fNNbAJtppb7GZ56D/43C1p6Gnwr4NWuVnyBH7SMMYRuAh/wX1SK9FpbsGPkvMOzEmm3LH8Zg9b/phV+I048LLkIU3mxtDdQf4NvgiuY6Q0S35rEIMTvddQaLZys/wFk73++l5pUAapzU5ooDSYmyjv4S49BrTGZyf8dZ+/ziK12TENlLfePJbNLXgjyM76rCPIYqQ2OwL3aBgyCZ9pGIGL8fncFmTcMZhfCbIYqc0+hDs0DOGAVxoKPF242AXJj/u8R3IltdmXGijdcNbimzrhVjYFr2sBHDDXxF0tCKnNvtEgxri5E4TPI5s+BQfgAnxqbh/O4jX8qmEADxXOwWYrzVNvaV9odcJ2+Mjcwtw3eWs5QR63LHsR5jF5SircjbLmWTeO2vos0g9/aFgEeSdYHryz07BXC0XQAg9q+B9cNPebqdNCUXyBbRomMASfa1g0/Nf0DtZqoQLcdfifZJcWqlTZ6KwAF6V2eBvbTBgAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAZCAYAAACl8achAAACK0lEQVR4Xu2WzUtUURjG374gIqEvgtSIPmgj1KZWhZsUDIIKokXgplq0iChcmrXMRS6tTSr0D6iIWm6CIDAokSiSoBSKyI19gEaI5PPwnonjM3fuOF9BND/4MXOf93DumTn3vveaVfk3uQ4HNCyAGXhQw0rSCD/ALVoogFY4BbdqoVJ8gRc1LIKn8J6G+VgHL8OH8CRcH/LH8DfsibIMG2GHZMWyFr6HvVrIxWE4Ad9qwXyyR+YLvya187BBslLogr80TGKf+RbPwwNSy9BsvuivknNX+KPKxQXz8+TlufnAq1qI2G4+Rid8I8elwg6i58hit/kg/sI0Tlj2og/JccxLuBn2m48ZgUdCrR1eCt+T+KaB0gYXYI0WBF5rPPlilB0LWRI3wueY+Zg1Ue0c7IyOFbbPVJ7AFxoK/Mc+m5/8QZQ3hSyJWrgJ/oTTUrsNr0gWw4aQyjgc1lBgS+PifpgvJsPxkOeixbzOVhnzDO6RLOa1Bgofv7NwgxYC28xP3G0rt5jsCrVccAdZr4uyzB9Azlpyu1zSQOFjk5MkdY56+AretOwFE7a6OQ0DO83nnZSc8/GS4UPpHdyxsvynMeSF28WB/Bf4VDwavn8yfxqmwe6QxGnzOe9K/t18B3gj3pIaOWOrXHQp7LX0m6pQhuCghpWAN3M54KXC9ntKC5WA28l3l1K5Az9aeV8LcnIfjmpYIPvN333YJv8avLb5DsOOUwx9GlSp8j+wDHtubVp8/cbQAAAAAElFTkSuQmCC>