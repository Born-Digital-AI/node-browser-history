const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const history = require('./index');

class CrossLanguageTestRunner {
    constructor() {
        this.pythonPath = './python-version';
        this.outputDir = './test-outputs';
        this.testResults = {
            js: {},
            python: {},
            comparisons: {}
        };
        
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir);
        }
    }

    async runJavaScriptTests() {
        console.log("\n🟨 Running JavaScript Tests...");
        console.log("=" .repeat(50));
        
        const jsTests = [
            { name: 'getChromeHistory', fn: () => this.testGetChromeOnly(), params: { minutes: 180 } },
            { name: 'getFirefoxHistory', fn: () => this.testFireFoxOnly(), params: { minutes: 180 } },
            { name: 'getEdgeHistory', fn: () => this.testMicrosoftEdgeOnly(), params: { minutes: 180 } }
        ];

        for (const test of jsTests) {
            try {
                const result = await test.fn();
                
                let count = 0;
                if (Array.isArray(result)) {
                    count = result[0] ? result[0].length : 0;
                } else {
                    count = result ? Object.keys(result).length : 0;
                }
                
                this.testResults.js[test.name] = {
                    success: true,
                    data: result,
                    count: count,
                    params: test.params
                };
                console.log(`✅ JS ${test.name}: ${count} records`);
            } catch (error) {
                this.testResults.js[test.name] = {
                    success: false,
                    error: error.message,
                    params: test.params
                };
                console.log(`❌ JS ${test.name}: Failed - ${error.message}`);
            }
        }
    }

    async runPythonTests() {
        console.log("\n🐍 Running Python Tests...");
        console.log("=" .repeat(50));
        
        if (!fs.existsSync(this.pythonPath)) {
            console.log("❌ Python submodule not found at", this.pythonPath);
            return;
        }

        const pythonTests = [
            { name: 'getChromeHistory', script: 'get_chrome_history.py', params: { minutes: 180 } },
            { name: 'getFirefoxHistory', script: 'get_firefox_history.py', params: { minutes: 180 } },
            { name: 'getEdgeHistory', script: 'get_edge_history.py', params: { minutes: 180 } }
        ];

        await this.createPythonTestScripts();

        for (const test of pythonTests) {
            try {
                const scriptPath = path.join(this.outputDir, test.script);
                const result = await this.runPythonScript(scriptPath);
                
                const parsedResult = JSON.parse(result.trim());
                this.testResults.python[test.name] = {
                    success: true,
                    data: parsedResult,
                    count: Array.isArray(parsedResult) ? parsedResult.length : (parsedResult && parsedResult.error ? 1 : 0),
                    params: test.params
                };
                
                if (parsedResult.error) {
                    console.log(`❌ Python ${test.name}: ${parsedResult.error}`);
                } else {
                    console.log(`✅ Python ${test.name}: ${this.testResults.python[test.name].count} records`);
                }
            } catch (error) {
                this.testResults.python[test.name] = {
                    success: false,
                    error: error.message,
                    params: test.params
                };
                console.log(`❌ Python ${test.name}: Failed - ${error.message}`);
            }
        }
    }

    runPythonScript(scriptPath) {
        return new Promise((resolve, reject) => {
            const python = spawn('python', [scriptPath], {
                env: { ...process.env, PYTHONPATH: this.pythonPath },
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Python script failed with code ${code}: ${stderr}`));
                } else {
                    resolve(stdout);
                }
            });
            
            python.on('error', (error) => {
                reject(new Error(`Failed to start python: ${error.message}`));
            });
        });
    }

    async createPythonTestScripts() {
        const scripts = {
            'get_all_history.py': `
import sys
import json
from datetime import datetime, timedelta
sys.path.insert(0, '${this.pythonPath.replace(/\\/g, '\\\\')}')

try:
    from browser_history import get_history
    
    # Call get_history() without any arguments (as per the API)
    outputs = get_history()
    
    # Filter to last 180 minutes
    cutoff_time = datetime.now() - timedelta(minutes=180)
    
    # Convert to format similar to JS version and filter by time
    result = []
    for record in outputs.histories:
        # record[0] is datetime, record[1] is url, record[2] is title
        if len(record) > 0 and record[0]:
            # Remove timezone info from record datetime for comparison
            record_time = record[0].replace(tzinfo=None) if record[0].tzinfo else record[0]
            if record_time >= cutoff_time:
                result.append({
                    'url': record[1] if len(record) > 1 else '',
                    'title': record[2] if len(record) > 2 else '',
                    'timestamp': str(record[0]) if len(record) > 0 else ''
                })
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`,
            'get_chrome_history.py': `
import sys
import json
from datetime import datetime, timedelta
sys.path.insert(0, '${this.pythonPath.replace(/\\/g, '\\\\')}')

try:
    from browser_history.browsers import Chrome
    
    chrome = Chrome()
    # Call fetch_history() without arguments (as per the API)
    history = chrome.fetch_history()
    
    # Filter to last 180 minutes
    cutoff_time = datetime.now() - timedelta(minutes=180)
    
    result = []
    for record in history.histories:
        # record[0] is datetime, record[1] is url, record[2] is title
        if len(record) > 0 and record[0]:
            # Remove timezone info from record datetime for comparison
            record_time = record[0].replace(tzinfo=None) if record[0].tzinfo else record[0]
            if record_time >= cutoff_time:
                result.append({
                    'url': record[1] if len(record) > 1 else '',
                    'title': record[2] if len(record) > 2 else '',
                    'timestamp': str(record[0]) if len(record) > 0 else ''
                })
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`,
            'get_firefox_history.py': `
import sys
import json
from datetime import datetime, timedelta
sys.path.insert(0, '${this.pythonPath.replace(/\\/g, '\\\\')}')

try:
    from browser_history.browsers import Firefox
    
    firefox = Firefox()
    # Call fetch_history() without arguments (as per the API)
    history = firefox.fetch_history()
    
    # Filter to last 180 minutes
    cutoff_time = datetime.now() - timedelta(minutes=180)
    
    result = []
    for record in history.histories:
        # record[0] is datetime, record[1] is url, record[2] is title
        if len(record) > 0 and record[0]:
            # Remove timezone info from record datetime for comparison
            record_time = record[0].replace(tzinfo=None) if record[0].tzinfo else record[0]
            if record_time >= cutoff_time:
                result.append({
                    'url': record[1] if len(record) > 1 else '',
                    'title': record[2] if len(record) > 2 else '',
                    'timestamp': str(record[0]) if len(record) > 0 else ''
                })
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`,
            'get_edge_history.py': `
import sys
import json
from datetime import datetime, timedelta
sys.path.insert(0, '${this.pythonPath.replace(/\\/g, '\\\\')}')

try:
    from browser_history.browsers import Edge
    
    edge = Edge()
    # Call fetch_history() without arguments (as per the API)
    history = edge.fetch_history()
    
    # Filter to last 180 minutes
    cutoff_time = datetime.now() - timedelta(minutes=180)
    
    result = []
    for record in history.histories:
        # record[0] is datetime, record[1] is url, record[2] is title
        if len(record) > 0 and record[0]:
            # Remove timezone info from record datetime for comparison
            record_time = record[0].replace(tzinfo=None) if record[0].tzinfo else record[0]
            if record_time >= cutoff_time:
                result.append({
                    'url': record[1] if len(record) > 1 else '',
                    'title': record[2] if len(record) > 2 else '',
                    'timestamp': str(record[0]) if len(record) > 0 else ''
                })
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`
        };

        for (const [filename, content] of Object.entries(scripts)) {
            const filePath = path.join(this.outputDir, filename);
            fs.writeFileSync(filePath, content.trim());
        }
    }

    compareResults() {
        console.log("\n🔍 Comparing Results...");
        console.log("=" .repeat(50));

        const testNames = ['getChromeHistory', 'getFirefoxHistory', 'getEdgeHistory'];

        for (const testName of testNames) {
            const jsResult = this.testResults.js[testName];
            const pythonResult = this.testResults.python[testName];

            console.log(`\n📊 ${testName}:`);
            
            if (!jsResult) {
                console.log("  ❌ JS: No result");
            } else if (!jsResult.success) {
                console.log(`  ❌ JS: Failed - ${jsResult.error}`);
            } else {
                console.log(`  ✅ JS: ${jsResult.count} records`);
            }

            if (!pythonResult) {
                console.log("  ❌ Python: No result");
            } else if (!pythonResult.success) {
                console.log(`  ❌ Python: Failed - ${pythonResult.error}`);
            } else if (pythonResult.data && pythonResult.data.error) {
                console.log(`  ❌ Python: Error - ${pythonResult.data.error}`);
            } else {
                console.log(`  ✅ Python: ${pythonResult.count} records`);
            }

            if (jsResult?.success && pythonResult?.success &&
                !(pythonResult.data && pythonResult.data.error)) {
                const countDiff = Math.abs(jsResult.count - pythonResult.count);
                const countPercent = jsResult.count > 0 ? (countDiff / jsResult.count * 100).toFixed(1) : 0;
                
                if (countDiff === 0) {
                    console.log("  🎯 Count match: Perfect!");
                } else if (countPercent < 5) {
                    console.log(`  ⚠️  Count difference: ${countDiff} records (${countPercent}% variance)`);
                } else {
                    console.log(`  ❗ Significant count difference: ${countDiff} records (${countPercent}% variance)`);
                }

                this.testResults.comparisons[testName] = {
                    jsCount: jsResult.count,
                    pythonCount: pythonResult.count,
                    difference: countDiff,
                    percentageDiff: parseFloat(countPercent)
                };
            }
        }
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                jsTests: Object.keys(this.testResults.js).length,
                pythonTests: Object.keys(this.testResults.python).length,
                jsSuccesses: Object.values(this.testResults.js).filter(r => r.success).length,
                pythonSuccesses: Object.values(this.testResults.python).filter(r => 
                    r.success && !(r.data && r.data.error)).length
            },
            results: this.testResults,
            platform: process.platform,
            nodeVersion: process.version
        };

        const reportPath = path.join(this.outputDir, `test-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`\n📝 Detailed report saved to: ${reportPath}`);
        return report;
    }

    async testGetChromeOnly() {
        return new Promise((resolve, reject) => {
            history.getChromeHistory(180).then(resolve).catch(reject);
        });
    }

    async testFireFoxOnly() {
        return new Promise((resolve, reject) => {
            history.getFirefoxHistory(180).then(resolve).catch(reject);
        });
    }

    async testMicrosoftEdgeOnly() {
        return new Promise((resolve, reject) => {
            history.getMicrosoftEdge(180).then(resolve).catch(reject);
        });
    }

    async runAll() {
        console.log("🚀 Starting Cross-Language Browser History Tests");
        console.log("=" .repeat(60));

        try {
            await this.runJavaScriptTests();
            await this.runPythonTests();
            this.compareResults();
            
            const report = this.generateReport();
            
            console.log("\n✅ Cross-language testing completed!");
            console.log(`📊 Summary: ${report.summary.jsSuccesses}/${report.summary.jsTests} JS tests passed, ${report.summary.pythonSuccesses}/${report.summary.pythonTests} Python tests passed`);
            
            return report;
        } catch (error) {
            console.error("❌ Test execution failed:", error.message);
            throw error;
        }
    }
}

module.exports = CrossLanguageTestRunner;

if (require.main === module) {
    const runner = new CrossLanguageTestRunner();
    runner.runAll()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}