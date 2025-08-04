const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

class PythonToJSSynchronizer {
    constructor(config = {}) {
        this.pythonSubmodulePath = config.pythonPath || './python-version';
        this.jsProjectPath = config.jsPath || './';
        this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
        this.logFile = config.logFile || './sync.log';
        this.isDryRun = config.isDryRun || false;
        
        if (!this.openaiApiKey) {
            throw new Error('OpenAI API key is required. Set OPENAI_API_KEY in .env file or environment variable.');
        }
    }

    getPythonLatestCommit() {
        try {
            return execSync('git rev-parse HEAD', {
                cwd: this.pythonSubmodulePath,
                encoding: 'utf8'
            }).trim();
        } catch (error) {
            this.log(`Error getting Python commit: ${error.message}`);
            return null;
        }
    }

    getLastSyncedCommit() {
        const syncFile = path.join(this.jsProjectPath, '.last-sync');
        if (fs.existsSync(syncFile)) {
            return fs.readFileSync(syncFile, 'utf8').trim();
        }
        return null;
    }

    storeLastSyncedCommit(commitHash) {
        if (this.isDryRun) {
            this.log(`[DRY RUN] Would store last synced commit: ${commitHash}`);
            return;
        }
        const syncFile = path.join(this.jsProjectPath, '.last-sync');
        fs.writeFileSync(syncFile, commitHash);
    }

    getPythonDiff(fromCommit, toCommit) {
        try {
            const diffCommand = fromCommit
                ? `git diff ${fromCommit}..${toCommit}`
                : `git show ${toCommit}`;

            return execSync(diffCommand, {
                cwd: this.pythonSubmodulePath,
                encoding: 'utf8'
            });
        } catch (error) {
            this.log(`Error getting diff: ${error.message}`);
            return null;
        }
    }

    readJavaScriptContext() {
        const jsFiles = ['index.js', 'browsers.js', 'history_paths.js', 'package.json'];
        const context = {};
        
        jsFiles.forEach(file => {
            const filePath = path.join(this.jsProjectPath, file);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                context[file] = content.length > 8000 ?
                    content.substring(0, 8000) + '\n\n// ... (truncated for brevity)' : 
                    content;
            }
        });
        
        return context;
    }

    async translateDiffToJS(pythonDiff) {
        const jsContext = this.readJavaScriptContext();
        
        const prompt = `
            You are a code translator specializing in converting Python browser-history library code to JavaScript.
            
            CURRENT JAVASCRIPT CODEBASE:
            ${Object.entries(jsContext).map(([file, content]) => 
                `--- ${file} ---\n${content}\n`
            ).join('\n')}
            
            PYTHON CHANGES TO TRANSLATE:
            \`\`\`
            ${pythonDiff}
            \`\`\`
            
            Based on the Python diff and the current JavaScript codebase structure above, provide the equivalent JavaScript changes that should be made to maintain feature parity.
            
            Consider:
            - Existing function signatures and patterns in the JS code
            - Current architecture and dependencies
            - Maintaining consistency with existing code style
            - Preserving backward compatibility where possible
            
            IMPORTANT: Respond ONLY with valid JSON. Do not include any explanatory text before or after the JSON.
            
            Format your response as JSON:
            {
              "summary": "Brief description of changes",
              "changes": [
                {
                  "file": "filename.js",
                  "action": "modify|create|delete",
                  "description": "What changes to make",
                  "code": "The actual JavaScript code to add/modify (complete functions/sections)",
                  "line_context": "Which part of the file to modify (e.g., 'after function getBrowserHistory', 'replace function xyz')"
                }
              ],
              "dependencies": ["new npm packages needed"],
              "breaking_changes": ["list of breaking changes"],
              "test_updates": ["suggested test updates"]
            }
            `;

        try {
            if (this.isDryRun) {
                this.log('[DRY RUN] Would call OpenAI API to translate diff');
                this.log(`[DRY RUN] Diff content (first 500 chars): ${pythonDiff.substring(0, 500)}...`);
                this.log(`[DRY RUN] Including context from ${Object.keys(jsContext).length} JS files`);
            }

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4-turbo-preview',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an expert code translator specializing in Python to JavaScript translation for browser history libraries. Always respond with valid JSON only, no additional text. Pay careful attention to the existing JavaScript code structure and patterns.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: 4000,
                    temperature: 0.1
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${data.error?.message || 'Unknown error'}`);
            }

            let responseContent = data.choices[0].message.content.trim();
            
            this.log(`Raw OpenAI response: ${responseContent.substring(0, 200)}...`);

            const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                responseContent = jsonMatch[0];
            }

            let translation;
            try {
                translation = JSON.parse(responseContent);
            } catch (parseError) {
                this.log(`JSON parsing failed. Response content: ${responseContent}`);
                throw new Error(`Failed to parse OpenAI response as JSON: ${parseError.message}`);
            }

            if (!translation || typeof translation !== 'object') {
                throw new Error('Invalid translation response: not an object');
            }

            translation.summary = translation.summary || 'No summary provided';
            translation.changes = translation.changes || [];
            translation.dependencies = translation.dependencies || [];
            translation.breaking_changes = translation.breaking_changes || [];
            translation.test_updates = translation.test_updates || [];

            return translation;

        } catch (error) {
            this.log(`Error translating diff: ${error.message}`);
            
            if (this.isDryRun) {
                this.log('[DRY RUN] Returning mock translation for demonstration');
                return {
                    summary: "Mock translation - Python diff contains merge commits and CLI improvements",
                    changes: [
                        {
                            file: "index.js",
                            action: "modify",
                            description: "Add error handling improvements from Python version",
                            code: "// Mock code change - would add better error handling",
                            line_context: "after existing error handling functions"
                        }
                    ],
                    dependencies: [],
                    breaking_changes: [],
                    test_updates: ["Update error handling tests"]
                };
            }
            
            return null;
        }
    }

    previewJSChanges(translation) {
        if (!translation || !translation.changes) {
            this.log('[DRY RUN] No valid translation received');
            return false;
        }

        console.log('\n🔍 DRY RUN PREVIEW - Changes that would be applied:');
        console.log('='.repeat(60));
        
        console.log(`\n📋 Summary: ${translation.summary}`);
        
        if (translation.changes && translation.changes.length > 0) {
            console.log(`\n📁 Files to be modified: ${translation.changes.length}`);
            
            translation.changes.forEach((change, index) => {
                console.log(`\n${index + 1}. ${change.action.toUpperCase()}: ${change.file}`);
                console.log(`   Description: ${change.description}`);
                
                const filePath = path.join(this.jsProjectPath, change.file);
                
                switch (change.action) {
                    case 'create':
                        console.log(`   ✅ Would create new file: ${change.file}`);
                        console.log(`   📄 File content preview (first 200 chars):`);
                        console.log(`   ${change.code.substring(0, 200)}${change.code.length > 200 ? '...' : ''}`);
                        break;
                        
                    case 'modify':
                        if (fs.existsSync(filePath)) {
                            console.log(`   ✏️  Would modify existing file: ${change.file}`);
                            console.log(`   📄 Code to be added:`);
                            console.log(`   ${change.code.substring(0, 200)}${change.code.length > 200 ? '...' : ''}`);
                        } else {
                            console.log(`   ⚠️  Warning: File ${change.file} does not exist!`);
                        }
                        break;
                        
                    case 'delete':
                        if (fs.existsSync(filePath)) {
                            console.log(`   🗑️  Would delete file: ${change.file}`);
                        } else {
                            console.log(`   ⚠️  Warning: File ${change.file} does not exist!`);
                        }
                        break;
                }
            });
        }

        if (translation.dependencies && translation.dependencies.length > 0) {
            console.log(`\n📦 Dependencies to install: ${translation.dependencies.length}`);
            translation.dependencies.forEach((dep, index) => {
                console.log(`   ${index + 1}. ${dep}`);
            });
            console.log(`   Command: npm install ${translation.dependencies.join(' ')}`);
        }

        if (translation.breaking_changes && translation.breaking_changes.length > 0) {
            console.log(`\n⚠️  Breaking changes detected: ${translation.breaking_changes.length}`);
            translation.breaking_changes.forEach((change, index) => {
                console.log(`   ${index + 1}. ${change}`);
            });
        }

        if (translation.test_updates && translation.test_updates.length > 0) {
            console.log(`\n🧪 Suggested test updates: ${translation.test_updates.length}`);
            translation.test_updates.forEach((update, index) => {
                console.log(`   ${index + 1}. ${update}`);
            });
        }

        console.log('\n' + '='.repeat(60));
        console.log('🔍 DRY RUN COMPLETE - No actual changes were made');
        
        return true;
    }

    async applyJSChanges(translation) {
        if (this.isDryRun) {
            return this.previewJSChanges(translation);
        }

        if (!translation || !translation.changes) {
            this.log('No valid translation received');
            return false;
        }

        this.log(`Applying changes: ${translation.summary}`);

        try {
            for (const change of translation.changes) {
                const filePath = path.join(this.jsProjectPath, change.file);

                switch (change.action) {
                    case 'create':
                        fs.writeFileSync(filePath, change.code);
                        this.log(`Created file: ${change.file}`);
                        break;

                    case 'modify':
                        if (fs.existsSync(filePath)) {
                            const existingContent = fs.readFileSync(filePath, 'utf8');
                            const updatedContent = `${existingContent}\n\n// Auto-generated update from Python sync\n${change.code}`;
                            fs.writeFileSync(filePath, updatedContent);
                            this.log(`Modified file: ${change.file}`);
                        }
                        break;

                    case 'delete':
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                            this.log(`Deleted file: ${change.file}`);
                        }
                        break;
                }
            }

            if (translation.dependencies && translation.dependencies.length > 0) {
                this.log(`Installing dependencies: ${translation.dependencies.join(', ')}`);
                execSync(`npm install ${translation.dependencies.join(' ')}`, {
                    cwd: this.jsProjectPath
                });
            }

            return true;
        } catch (error) {
            this.log(`Error applying changes: ${error.message}`);
            return false;
        }
    }

    updateSubmodule() {
        if (this.isDryRun) {
            this.log('[DRY RUN] Would update submodule with: git submodule update --remote python-version');
            return true;
        }

        try {
            execSync('git submodule update --remote python-version', {
                cwd: this.jsProjectPath
            });
            this.log('Submodule updated successfully');
            return true;
        } catch (error) {
            this.log(`Error updating submodule: ${error.message}`);
            return false;
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;

        console.log(logMessage);
        
        if (!this.isDryRun) {
            fs.appendFileSync(this.logFile, logMessage + '\n');
        }
    }

    async dryRun(isForce = false) {
        this.isDryRun = true;
        console.log('🔍 Starting DRY RUN - Python to JavaScript synchronization analysis...');
        console.log('ℹ️  No actual changes will be applied to your files\n');

        const currentCommit = this.getPythonLatestCommit();
        const lastSyncedCommit = this.getLastSyncedCommit();

        if (!currentCommit) {
            console.log('❌ Could not get current Python commit');
            return false;
        }

        console.log(`📊 Current Python commit: ${currentCommit}`);
        console.log(`📊 Last synced commit: ${lastSyncedCommit || 'None (first sync)'}`);

        if (currentCommit === lastSyncedCommit && !isForce) {
            console.log('✅ No new changes in Python version, sync not needed');
            console.log('💡 Use --force flag to sync anyway');
            return true;
        }

        if (isForce && currentCommit === lastSyncedCommit) {
            console.log('⚠️  FORCE mode: Proceeding even though no changes detected');
        }

        console.log(`\n🔄 Changes detected from ${lastSyncedCommit || 'initial'} to ${currentCommit}`);

        const diff = this.getPythonDiff(lastSyncedCommit, currentCommit);
        if (!diff) {
            console.log('❌ Could not get diff');
            return false;
        }

        const diffLines = diff.split('\n');
        const codeAddedLines = diffLines.filter(line => 
            line.startsWith('+') && 
            !line.startsWith('+++') && 
            line.trim() !== '+' &&
            !line.startsWith('+ ')
        ).length;
        
        const codeRemovedLines = diffLines.filter(line => 
            line.startsWith('-') && 
            !line.startsWith('---') && 
            line.trim() !== '-' &&
            !line.startsWith('- ')
        ).length;

        const modifiedFiles = [...new Set(diffLines
            .filter(line => line.startsWith('+++') || line.startsWith('---'))
            .map(line => line.split('\t')[0].replace(/^\+\+\+\s|^---\s/, ''))
            .filter(file => file !== '/dev/null')
        )];

        console.log(`\n📝 Diff summary:`);
        console.log(`   📈 Code lines added: ${codeAddedLines}`);
        console.log(`   📉 Code lines removed: ${codeRemovedLines}`);
        console.log(`   📁 Files modified: ${modifiedFiles.length}`);
        
        if (modifiedFiles.length > 0) {
            modifiedFiles.forEach(file => console.log(`      - ${file}`));
        }

        const hasRealChanges = codeAddedLines > 0 || codeRemovedLines > 0 || modifiedFiles.length > 0;
        
        if (!hasRealChanges && !isForce) {
            console.log('\n✅ No meaningful code changes detected (only whitespace/formatting)');
            console.log('💡 Skipping LLM analysis to save API costs');
            console.log('💡 Use --force flag if you want to analyze anyway');
            return true;
        }

        if (!hasRealChanges && isForce) {
            console.log('\n⚠️  FORCE mode: Analyzing even though no meaningful changes detected');
        }

        if (hasRealChanges) {
            console.log(`\n📄 Diff preview (first 1000 chars):`);
            console.log(diff.substring(0, 1000) + (diff.length > 1000 ? '...' : ''));
        }

        console.log('\n🤖 Analyzing changes with LLM...');
        
        try {
            const translation = await this.translateDiffToJS(diff);

            if (!translation) {
                console.log('❌ Failed to translate changes');
                console.log('💡 This could be due to:');
                console.log('   • OpenAI API issues');
                console.log('   • Invalid API key');
                console.log('   • Network connectivity problems');
                console.log('   • Malformed diff content');
                return false;
            }

            const success = await this.applyJSChanges(translation);

            if (success) {
                console.log('\n✅ Dry run analysis completed successfully!');
                console.log('💡 To apply these changes, run the sync without --dry-run flag');
                return true;
            } else {
                console.log('\n❌ Dry run analysis failed');
                return false;
            }
        } catch (error) {
            console.log(`\n❌ Error during LLM analysis: ${error.message}`);
            console.log('💡 Try running again or check your API key and network connection');
            return false;
        }
    }

    async sync(isForce = false) {
        if (this.isDryRun) {
            return this.dryRun(isForce);
        }

        this.log('Starting Python to JavaScript synchronization...');

        if (!this.updateSubmodule()) {
            this.log('Failed to update submodule, aborting sync');
            return false;
        }

        const currentCommit = this.getPythonLatestCommit();
        const lastSyncedCommit = this.getLastSyncedCommit();

        if (!currentCommit) {
            this.log('Could not get current Python commit');
            return false;
        }

        if (currentCommit === lastSyncedCommit && !isForce) {
            this.log('No new changes in Python version, sync not needed');
            return true;
        }

        if (isForce && currentCommit === lastSyncedCommit) {
            this.log('FORCE mode: Proceeding even though no changes detected');
        }

        this.log(`Syncing from ${lastSyncedCommit || 'initial'} to ${currentCommit}`);

        const diff = this.getPythonDiff(lastSyncedCommit, currentCommit);
        if (!diff) {
            this.log('Could not get diff');
            return false;
        }

        const diffLines = diff.split('\n');
        const codeAddedLines = diffLines.filter(line => 
            line.startsWith('+') && 
            !line.startsWith('+++') && 
            line.trim() !== '+' &&
            !line.startsWith('+ ')
        ).length;
        
        const codeRemovedLines = diffLines.filter(line => 
            line.startsWith('-') && 
            !line.startsWith('---') && 
            line.trim() !== '-' &&
            !line.startsWith('- ')
        ).length;

        const hasRealChanges = codeAddedLines > 0 || codeRemovedLines > 0;
        
        if (!hasRealChanges && !isForce) {
            this.log('No meaningful code changes detected, skipping LLM analysis');
            this.storeLastSyncedCommit(currentCommit);
            return true;
        }

        this.log('Translating changes using LLM...');
        const translation = await this.translateDiffToJS(diff);

        if (!translation) {
            this.log('Failed to translate changes');
            return false;
        }

        const success = await this.applyJSChanges(translation);

        if (success) {
            this.storeLastSyncedCommit(currentCommit);
            this.log('Synchronization completed successfully');

            if (translation.breaking_changes && translation.breaking_changes.length > 0) {
                this.log('WARNING: Breaking changes detected:');
                translation.breaking_changes.forEach(change => {
                    this.log(`  - ${change}`);
                });
            }

            return true;
        } else {
            this.log('Failed to apply changes');
            return false;
        }
    }
}

module.exports = PythonToJSSynchronizer;

if (require.main === module) {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isForce = args.includes('--force');
    
    const config = {
        openaiApiKey: process.env.OPENAI_API_KEY,
        pythonPath: args.find(arg => !arg.startsWith('--')) || './python-version',
        jsPath: './',
        isDryRun: isDryRun
    };

    const synchronizer = new PythonToJSSynchronizer(config);

    synchronizer.sync(isForce)
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Sync failed:', error);
            process.exit(1);
        });
}