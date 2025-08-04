const PythonToJSSynchronizer = require('./python-to-js-synchronizer');
require('dotenv').config();

function printUsage() {
    console.log('\n📖 Usage:');
    console.log('  node scripts/sync-script.js [options]');
    console.log('\n⚙️  Options:');
    console.log('  --dry-run    Analyze changes without applying them');
    console.log('  --force      Force sync even if no changes detected');
    console.log('  --help       Show this help message');
    console.log('\n💡 Examples:');
    console.log('  node scripts/sync-script.js --dry-run     # Preview changes');
    console.log('  node scripts/sync-script.js               # Apply changes');
    console.log('  node scripts/sync-script.js --force       # Force sync');
    console.log('  node scripts/sync-script.js --dry-run --force  # Force preview');
    console.log('');
}

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isForce = args.includes('--force');
    const showHelp = args.includes('--help') || args.includes('-h');

    if (showHelp) {
        printUsage();
        return;
    }

    console.log('🔄 Manual Python to JavaScript Synchronization');
    console.log('==========================================');

    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be applied');
    }

    if (isForce) {
        console.log('⚠️  FORCE MODE - Will sync even if no changes detected');
    }

    if (!process.env.OPENAI_API_KEY) {
        console.error('❌ OPENAI_API_KEY not found in .env file or environment variables');
        console.log('💡 Make sure you have a .env file with OPENAI_API_KEY=your-api-key');
        console.log('💡 Note: API key is only needed when there are actual changes to process');
        
        if (!isForce) {
            process.exit(1);
        } else {
            console.log('⚠️  Continuing in force mode - this may fail if changes are detected');
        }
    }

    try {
        const synchronizer = new PythonToJSSynchronizer({
            openaiApiKey: process.env.OPENAI_API_KEY,
            isDryRun: isDryRun
        });

        if (isDryRun) {
            console.log('\n🔍 Starting dry run analysis...');
            console.log('This will:');
            console.log('  ✓ Check for Python submodule changes');
            console.log('  ✓ Generate diff between versions');
            if (isForce) {
                console.log('  ✓ Force analyze using AI (even if no changes)');
            } else {
                console.log('  ✓ Translate changes using AI (only if needed)');
            }
            console.log('  ✓ Show what files would be modified');
            console.log('  ✗ NOT apply any actual changes');
            console.log('');

            const success = await synchronizer.dryRun(isForce);
            
            if (success) {
                console.log('\n🎉 Dry run completed successfully!');
                console.log('');
                console.log('🚀 Next steps:');
                console.log('  • Review the proposed changes above');
                console.log('  • If satisfied, run: npm run sync');
                console.log('  • Or run: node scripts/sync-script.js (without --dry-run)');
            } else {
                console.log('\n❌ Dry run failed - check the output above for errors');
                process.exit(1);
            }
            return;
        }

        console.log('\n🚀 Starting synchronization...');
        const success = await synchronizer.sync(isForce);
        
        if (success) {
            console.log('\n✅ Synchronization completed successfully!');
            console.log('📄 Check sync.log for detailed information');
            
            console.log('\n📋 What was done:');
            console.log('  ✓ Updated Python submodule');
            console.log('  ✓ Analyzed code differences');
            console.log('  ✓ Applied JavaScript translations');
            console.log('  ✓ Updated tracking files');
        } else {
            console.log('\n❌ Synchronization failed');
            console.log('📄 Check sync.log for error details');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n💥 Error during synchronization:', error.message);
        
        if (error.message.includes('OPENAI_API_KEY')) {
            console.log('\n💡 Troubleshooting:');
            console.log('  • Check that your .env file exists');
            console.log('  • Verify OPENAI_API_KEY is set correctly');
            console.log('  • Make sure the API key is valid');
        }
        
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}