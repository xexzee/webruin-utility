const dotenv = require('dotenv').config();
const {MongoClient} = require('mongodb');
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

async function catalog_items() {

    // read items in staging directory
    let stagedItems = fs.readdirSync(process.env.STAGING_PATH).filter(itemName => itemName !== '.gitignore' && itemName !== 'desktop.ini');
    if(stagedItems.length === 0) {
        console.log(redify('STAGIN DIRECTORY IS EMPTY; NO ITEMS TO BE CATALOGED'));
        process.exit();
    }

    // initialize database
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const mongoCollection = mongoClient.db(process.env.MONGODB_DATABASE).collection(process.env.MONGODB_COLLECTION);

    // initialize gcs
    const storage = new Storage();

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
                answer = await new Promise(resolve => readline.question(magentify('TYPE (' + types.toString() + '): '), answer => resolve(answer)));
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
                answer = await new Promise(resolve => readline.question('(y/n): ', answer => resolve(answer)));
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
                await storage.bucket(process.env.GCS_BUCKETNAME).upload(process.env.STAGING_PATH + filename, {destination: data._id + '/' + filename});
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
    process.exit();
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

catalog_items();