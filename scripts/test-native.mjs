import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw new Error('Native source tests require macOS with Swift, PDFKit, Vision and sandbox-exec.');
const result=spawnSync(process.execPath,['--import','tsx','--test','test/source-sanitizer.test.mjs','test/source-ocr-coverage.test.mjs','test/source-ingestion-evidence.test.mjs','test/source-evidence-http.test.mjs'],{stdio:'inherit',env:{...process.env,NOEMA_NATIVE_TESTS:'1'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
