const CrossLanguageTestRunner = require('./test-runner');

let history = require("./index");

function testGetAllHistory() {
    console.log("***** RUNNING GET ALL HISTORY TEST *****");
    return new Promise(res => {
        history.getAllHistory(60).then(browsers => {
            let allHistory = []
            for(let browser of browsers){
                for(let record of browser){
                    allHistory.push(record)
                }
            }
            console.log("PASS GET ALL HISTORY");
            console.log(allHistory);
            res(allHistory);
        }).catch(error => {
            console.log("***** FAILED TO GET ALL HISTORY *****");
            return Promise.reject(error);
        });
    });
}

function testGetChromeOnly() {
    console.log("***** RUNNING GET CHROME ONLY *****");
    return new Promise(res => {
        history.getChromeHistory(180).then(history => {
            console.log("PASS GET CHROME ONLY");
            console.log(history);
            res(history);
        }).catch(error => {
            console.log("***** FAIL TO GET CHROME ONLY *****");
            return Promise.reject(error);
        });
    });
}

function testFireFoxOnly() {
    console.log("***** RUNNING GET FIREFOX ONLY *****");
    return new Promise(res => {
        history.getFirefoxHistory(180).then(history => {
            console.log("PASS GET FIREFOX ONLY");
            console.log(history);
            res(history);
        }).catch(error => {
            console.log("***** FAIL TO GET FIREFOX ONLY *****");
            return Promise.reject(error);
        });
    });
}

function testMicrosoftEdgeOnly() {
    console.log("***** RUNNING GET MICROSOFT EDGE ONLY *****");
    return new Promise(res => {
        history.getMicrosoftEdge(180).then(history => {
            console.log("PASS GET MICROSOFT EDGE ONLY");
            console.log(history);
            res(history);
        }).catch(error => {
            console.log("***** FAIL TO GET MICROSOFT EDGE ONLY *****");
            return Promise.reject(error);
        });
    });
}

function parseArgs() {
    const args = process.argv.slice(2);
    return {
        crossLanguage: args.includes('--cross-language') || args.includes('-c'),
        pythonOnly: args.includes('--python-only') || args.includes('-p'),
        jsOnly: args.includes('--js-only') || args.includes('-j'),
        help: args.includes('--help') || args.includes('-h')
    };
}

function showHelp() {
    console.log(`
        Browser History Test Runner
        
        Usage:
          node test.js [options]
        
        Options:
          --cross-language, -c    Run tests for both JS and Python versions and compare
          --python-only, -p       Run only Python version tests
          --js-only, -j           Run only JavaScript version tests (default)
          --help, -h              Show this help message
        
        Examples:
          node test.js                    # Run original JS tests
          node test.js --cross-language   # Run both JS and Python tests with comparison
          node test.js --python-only      # Run only Python tests
    `);
}

async function main() {
    const options = parseArgs();

    if (options.help) {
        showHelp();
        return;
    }

    if (options.crossLanguage) {
        console.log("🔄 Running cross-language comparison tests...");
        const runner = new CrossLanguageTestRunner();
        await runner.runAll();
        return;
    }

    if (options.pythonOnly) {
        console.log("🐍 Running Python-only tests...");
        const runner = new CrossLanguageTestRunner();
        await runner.runPythonTests();
        return;
    }

    console.log("🟨 Running original JavaScript tests...");
    
    let tests = [
        testGetChromeOnly(),
        testFireFoxOnly(),
        testMicrosoftEdgeOnly(),
        testGetAllHistory(),
    ];

    Promise.all(tests).then(() => {
        console.log("✅ PASSING ALL TESTS");
        process.exit(0);
    }).catch(error => {
        console.log('❌ FAILING TESTS')
        console.log(error)
        process.exit(1);
    });
}

main().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
});