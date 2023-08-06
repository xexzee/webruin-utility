const dotenv = require('dotenv').config();
const {MongoClient, ObjectId} = require('mongodb');
const fs = require('fs');
const readline = require('readline').createInterface({input: process.stdin, output: process.stdout});
const {Storage} = require('@google-cloud/storage');
const sizeOf = require('image-size');

const types = ['archived-audio', 'archived-image', 'software', 'screenshot', 'physical'];
const typesWithUpscaledVersions = ['archived-image', 'software', 'screenshot'];
const typesWithOriginalSources = ['archived-audio', 'archived-image'];
const typesWithAURL = ['archived-audio', 'archived-image', 'software', 'screenshot'];
const typesWithCreators = ['software'];
const typesWithMultipleFiles = ['physical', 'software'];
const typesWithDisplayDimensions = ['archived-image', 'software', 'screenshot', 'phyisical'];
const actions = ['catalog', 'delete', 'exit'];

let mongoClient = null;
let mongoCollection = null;
let gcsBucket = null;

async function initializeConnections() {

    // initialize database
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    mongoCollection = mongoClient.db(process.env.MONGODB_DATABASE).collection(process.env.MONGODB_COLLECTION);

    // initialize gcs
    let gcs = new Storage();
    gcsBucket = gcs.bucket(process.env.GCS_BUCKETNAME);

}

async function catalog_items() {

    // read items in staging directory
    let stagedItems = fs.readdirSync(process.env.STAGING_PATH).filter(itemName => itemName !== '.gitignore' && itemName !== 'desktop.ini');
    if(stagedItems.length === 0) {
        console.log(redify('STAGING DIRECTORY IS EMPTY; NO ITEMS TO BE CATALOGED'));
        process.exit();
    }

    while(stagedItems.length > 0) {

        // initialize data
        let data = {
            name: stagedItems.find(itemName => !itemName.includes('-upscaled.')),
            dateAdded: new Date()
        }
        console.log(cyanify('FILE NAME: ' + data.name));

        // check that name is valid
        if(!data.name) {
            console.log(redify('ITEM NAME WAS READ AS ' + data.name + ', CHECK FILES IN STAGING DIRECTORY'));
            process.exit();
        }

        // prompt for data type
        data.type = await new Promise(resolve => readline.question(magentify('TYPE: '), async answer => {
            while(true) {
                if(types.includes(answer))
                    return resolve(answer);
                answer = await new Promise(resolve => readline.question(magentify('TYPE (' + types.toString().replaceAll(',', ', ') + '): '), answer => resolve(answer)));
            }
        }));

        // get display dimensions
        if(typesWithDisplayDimensions.includes(data.type)) {
            let dimensions = sizeOf(process.env.STAGING_PATH + '/' + data.name);
            data.displayHeight = dimensions.height;
            data.displayWidth = dimensions.width;
        }

        // pull in all filenames for items with multiple files
        if(typesWithMultipleFiles.includes(data.type)) {
            if(!data.name.includes('-1.')) {
                console.log(redify('INCORRECT NAMING CONVENTION FOR TYPE WITH MULTIPLE FILES; ' + data.name + ' AS THE FIRST ITEM DOES IS NOT PREFIXED WITH A "-1" BEFORE THE FILE EXTENSION'));
                process.exit();
            }
            data.filenames = stagedItems.filter(filename => data.name.substring(0, data.name.lastIndexOf('-')) === filename.substring(0, filename.lastIndexOf('-'))).sort();
        }
        else {
            data.filenames = [data.name];
        }

        // populate upscaled filenames
        if(typesWithUpscaledVersions.includes(data.type)) {
            upscaledFilenames = [];
            data.filenames.forEach(filename => {
                let upscaledFilename = stagedItems.find(upscaledFilename => upscaledFilename.indexOf(filename.substring(0, filename.lastIndexOf('.'))) === 0 && upscaledFilename.includes('-upscaled.'));
                if(!upscaledFilename) {
                    console.log(redify('UPSCALED FILE MISSING FOR ' + filename + '; RECHECK FILES IN STAGING DIRECTORY'));
                    process.exit();
                }
                upscaledFilenames.push(upscaledFilename);
            });
            data.filenames = data.filenames.concat(upscaledFilenames);
            data.filenames.sort();
        }

        // prompt for original source
        if(typesWithOriginalSources.includes(data.type)) {
            data.originalSourceURL = await new Promise(resolve => {
                readline.question(magentify('SOURCE: '), async answer => {
                    return resolve(answer);
                });
            });
        }

        // prompt for item name if its not an item with its own source
        else {
            data.name = await new Promise(resolve => {
                readline.question(magentify('ITEM NAME: '), async answer => {
                    return resolve(answer);
                });
            });
        }

        // prompt for the creator(s) name(s) if required
        if(typesWithCreators.includes(data.type)) {
            data.creators = [];
            let enteringCreators = true;
            while(enteringCreators) {
                data.creators.push(await new Promise(resolve => readline.question(magentify('CREATOR NAME: '), answer => resolve(answer))));
                enteringCreators = await new Promise(resolve => readline.question(magentify('ENTER ANOTHER CREATOR? (y/n):'), async answer => {
                    while(true) {
                        if(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes') 
                            return resolve(true);
                        else if(answer.toLowerCase().trim() === 'n' || answer.toLowerCase().trim() === 'no')
                            return resolve(false);
                        answer = await new Promise(resolve => readline.question(magentify('(y/n): '), answer => resolve(answer)));
                    }
                }));
            }
        }
        
        // prompt for the items website url
        if(typesWithAURL.includes(data.type)) {
            data.websiteURL = await new Promise(resolve => {
                readline.question(magentify('FOUND AT: '), async answer => {
                    return resolve(answer);
                });
            });
        }
        
        // prompt for description
        data.description = await new Promise(resolve => readline.question(magentify('DESCRIPTION: '), answer => {
            return resolve(answer);
        }));

        // prompt for tags
        data.tags = [];
        let enteringTags = true;
        while(enteringTags) {
            data.tags.push(await new Promise(resolve => readline.question(magentify('TAG: '), answer => resolve(answer))));
            enteringTags = await new Promise(resolve => readline.question(magentify('ENTER ANOTHER TAG? (y/n):'), async answer => {
                while(true) {
                    if(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes') 
                        return resolve(true);
                    else if(answer.toLowerCase().trim() === 'n' || answer.toLowerCase().trim() === 'no')
                        return resolve(false);
                    answer = await new Promise(resolve => readline.question(magentify('(y/n): '), answer => resolve(answer)));
                }
            }));
        }

        // verify that all data looks correct
        let redoItem = await new Promise(resolve => readline.question(cyanify('FINAL DATA TO BE ADDED:\n' + JSON.stringify(data, null, 4)) + magentify('\nDOES THIS LOOK CORRECT? (y/n): '), async answer => {
            while(true) {
                if(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes') 
                    return resolve(false);
                else if(answer.toLowerCase().trim() === 'n' || answer.toLowerCase().trim() === 'no')
                    return resolve(true);
                answer = await new Promise(resolve => readline.question(magentify('(y/n): '), answer => resolve(answer)));
            }
        }));

        if(!redoItem) {

            // upload item data to database
            console.log(cyanify('UPLOADING "' + data.name + '"\'S DATA TO MONGODB...'));
            await mongoCollection.insertOne(data);
            console.log(cyanify('UPLOAD SUCCESSFUL!'));

            // save data to item directory
            fs.mkdirSync(process.env.CATALOGED_PATH + data._id);
            fs.writeFileSync(process.env.CATALOGED_PATH + data._id + '/data.json', JSON.stringify(data));

            // upload item files to the gcs bucket
            for(filename of data.filenames) {
                console.log(cyanify('UPLOADING ' + filename + ' TO GCS BUCKET...'));
                await gcsBucket.upload(process.env.STAGING_PATH + filename, {destination: data._id + '/' + filename});
                console.log(cyanify('UPLOAD SUCCESSFUL!'));
            }

            // copy files from staging directory to final directory
            for(filename of data.filenames) {
                console.log(cyanify('COPYING ' + filename + ' TO CATALOGED DIRECTORY...'));
                fs.copyFileSync(process.env.STAGING_PATH + filename, process.env.CATALOGED_PATH + data._id + '/' + filename);
                console.log(cyanify('COPIED TO ' + process.env.CATALOGED_PATH + data._id + '/' + filename + ' SUCCESSFULLY!'));
            }

            // delete files from staging directory
            for(filename of data.filenames) {
                fs.rmSync(process.env.STAGING_PATH + filename);
            }

            console.log(cyanify('---'));
        } else {
            console.log(cyanify('REDOING ITEM FROM BEGINNING...'));
        }
        stagedItems = fs.readdirSync(process.env.STAGING_PATH).filter(itemName => itemName !== '.gitignore' && itemName !== 'desktop.ini');
    }

    console.log(cyanify('ALL ITEMS CALATOGED!! YAY!!! (´ω｀^=)~'));
}

function cyanify(string) {
    return '\x1b[36m' + string + '\x1b[0m';
}

function magentify(string) {
    return '\x1b[35m' + string + '\x1b[0m';
}

function redify(string) {
    return '\x1b[31m' + string + '\x1b[0m';
}

async function main() {

    // start program
    let running = true;
    while(running) {

        // prompt for action
        let action = await new Promise(resolve => readline.question(magentify('ACTION: '), async answer => {
            while(true) {
                if(actions.includes(answer))
                    return resolve(answer);
                answer = await new Promise(resolve => readline.question(magentify('ACTION (' + actions.toString().replaceAll(',', ', ') + '): '), answer => resolve(answer)));
            }
        }));

        // initialize connections
        initializeConnections();

        // execute action
        if(action === 'catalog')
            await catalog_items();
        else if(action === 'delete')
            await delete_items();
        else if(action === 'exit')
            break;

        // prompt to continue
        running = await new Promise(resolve => readline.question(magentify('CONTINUE WITH ANOTHER ACTION? (y/n): '), async answer => {
            while(true) {
                if(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes') 
                    return resolve(true);
                else if(answer.toLowerCase().trim() === 'n' || answer.toLowerCase().trim() === 'no')
                    return resolve(false);
                answer = await new Promise(resolve => readline.question(magentify('(y/n): '), answer => resolve(answer)));
            }
        }));
    }

    // end the program's execution
    console.log(cyanify('BAII~!!! ⸜(｡> ᵕ < )⸝'));
    await mongoClient.close();
    process.exit();
}

async function delete_items() {

    let deleting = true;
    while(deleting) {

        // prompt for item id
        let itemId = await new Promise(resolve => readline.question(magentify('ITEM ID: '), async answer => {
            while(true) {
                try {
                    let itemId = new ObjectId(answer);
                    return resolve(itemId);
                } catch(e) {
                    answer = await new Promise(resolve => readline.question(magentify('ITEM ID: (must be of valid object id format: a string of 12 bytes or 24 hex characters, or an integer): '), answer => resolve(answer)));
                }
            }
        }));

        console.log(cyanify('FETCHING ITEM...'));
        let item = await mongoCollection.findOne({_id: itemId});
        let continuePrompt = null;
        if(item) {
            console.log(cyanify('ITEM FOUND!'));
            let confirmDeletion = await new Promise(resolve => readline.question(magentify('DELETE ITEM "' + item.name + '"? (y/n): '), async answer => {
                while(true) {
                    if(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes') 
                        return resolve(true);
                    else if(answer.toLowerCase().trim() === 'n' || answer.toLowerCase().trim() === 'no')
                        return resolve(false);
                    answer = await new Promise(resolve => readline.question(magentify('(y/n): '), answer => resolve(answer)));
                }
            }));
            if(confirmDeletion) {
                if(!itemId || !itemId.toString() || itemId.toString() === '/' || !itemId.toString().trim()) {
                    console.log(redify('ITEM ID WAS FOUND TO BE "' + itemId.toString() + '" RIGHT BEFORE DELETION, RECHECK PROGRAM CODE AND/OR ITEM ID'));
                    process.exit();
                }
                console.log(cyanify('DELETING ITEM DATA...'));
                await mongoCollection.deleteOne({_id: itemId});
                console.log(cyanify('ITEM DATA SUCCESSFULLY DELETED!'));
                console.log(cyanify('DELETING ITEM FILES FROM GCS...'));
                let gcsFiles = (await gcsBucket.getFiles({ prefix: itemId.toString() + '/' }))[0];
                let numberOfDeletedFilesFromGcs = 0;
                let fileDeletionPromises = [];
                for(const file of gcsFiles) {
                    fileDeletionPromises.push(new Promise((resolve, reject) => {
                        file.delete((error, response) => {
                            if(error) {
                                console.log(redify('ERROR ENCOUNTERED WHEN TRYING TO DELETE FILE "' + '", FILE WAS NOT LIKELY NOT PROPERLY DELETED'));
                                console.log(redify('FULL ERROR:'));
                                console.log(error);
                            }
                            else {
                                console.log(cyanify('FILE "' + file.name + '" WAS SUCCESSFULLY DELETED!'));
                                numberOfDeletedFilesFromGcs++;
                            }
                            resolve();
                        });
                    }));
                }
                await Promise.all(fileDeletionPromises);
                console.log(cyanify(numberOfDeletedFilesFromGcs + ' FILE(S) SUCCESSFULLY DELETED FROM GCS!'));
                console.log(cyanify('DELETING ITEM FILES FROM LOCAL STORAGE...'));
                let filesSavedLocally = fs.readdirSync(process.env.CATALOGED_PATH + itemId.toString());
                fs.rmSync(process.env.CATALOGED_PATH + itemId.toString(), {recursive: true, force: true});
                console.log(cyanify(filesSavedLocally.length + ' FILE(S) DELETED FROM LOCAL STORAGE SUCCESFULLY! ("' + filesSavedLocally.toString().replaceAll(',', '", "') + '")'));
            }
            continuePrompt = magentify('CONTINUE WITH A NEW ITEM ID? (y/n): ');
        }
        else {
            console.log(redify('NO ITEM WITH ID ' + itemId + ' WAS FOUND TO EXIST...'));
            continuePrompt = magentify('TRY AGAIN WITH A DIFFERENT ITEM ID? (y/n): ');
        }

        deleting = await new Promise(resolve => readline.question(continuePrompt, async answer => {
            while(true) {
                if(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes') 
                    return resolve(true);
                else if(answer.toLowerCase().trim() === 'n' || answer.toLowerCase().trim() === 'no')
                    return resolve(false);
                answer = await new Promise(resolve => readline.question(magentify('(y/n): '), answer => resolve(answer)));
            }
        }));
    }
}

main();