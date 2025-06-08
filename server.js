const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection details
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'ProspectDb';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'PlayFabUserData';
const INVENTORY_KEY = process.env.INVENTORY_KEY || 'Inventory'; 

let db = null;
let client = null;

let userStats = {
    totalUsers: 0,
    activeUsers: 0,
    lastUpdated: new Date().toISOString()
};

// Generate anonymous user ID
function generateAnonymousId() {
    const machineId = crypto.createHash('sha256')
        .update(os.hostname() + os.platform() + os.arch())
        .digest('hex')
        .substring(0, 16);
    return machineId;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from public directory

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Register/ping user endpoint
app.post('/api/user/ping', async (req, res) => {
    try {
        const anonymousId = generateAnonymousId();
        
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Database not connected' 
            });
        }

        const statsCollection = db.collection('UserStats');
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        // Update or create user record
        await statsCollection.updateOne(
            { userId: anonymousId },
            { 
                $set: { 
                    lastSeen: now,
                    version: req.body.version || '1.0.0'
                }
            },
            { upsert: true }
        );

        // Count total unique users
        const totalUsers = await statsCollection.countDocuments();
        
        // Count active users (seen in last 5 minutes)
        const activeUsers = await statsCollection.countDocuments({
            lastSeen: { $gte: fiveMinutesAgo }
        });

        userStats = {
            totalUsers,
            activeUsers,
            lastUpdated: now.toISOString()
        };

        res.json({ 
            success: true, 
            stats: userStats,
            yourId: anonymousId.substring(0, 8) // Show first 8 chars for debugging
        });
    } catch (error) {
        console.error('Error updating user stats:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update user stats',
            stats: userStats // Return cached stats on error
        });
    }
});

// Get user stats endpoint
app.get('/api/user/stats', (req, res) => {
    res.json({ 
        success: true, 
        stats: userStats 
    });
});

// Connect to MongoDB
app.post('/api/connect', async (req, res) => {
    try {
        console.log('Attempting to connect to MongoDB...');
        console.log(`Connection URL: ${MONGO_URL}`);
        console.log(`Database: ${DB_NAME}`);
        console.log(`Collection: ${COLLECTION_NAME}`);
        
        // Close existing connection if any
        if (client) {
            await client.close();
            console.log('Closed existing connection');
        }
        
        client = new MongoClient(MONGO_URL, {
            serverSelectionTimeoutMS: 10000, // 10 second timeout
            connectTimeoutMS: 10000,
        });
        
        await client.connect();
        console.log('Connected to MongoDB server');
        
        db = client.db(DB_NAME);
        console.log(`Selected database: ${DB_NAME}`);
        
        // Test the connection by trying to access the collection
        const collection = db.collection(COLLECTION_NAME);
        const count = await collection.countDocuments();
        
        console.log(`Successfully connected to MongoDB - Found ${count} documents in ${COLLECTION_NAME}`);
        
        // Also check for documents with Inventory key
        const inventoryCount = await collection.countDocuments({ 
            [INVENTORY_KEY]: { $exists: true } 
        });
        console.log(`Found ${inventoryCount} documents with '${INVENTORY_KEY}' key`);
        
        res.json({ 
            success: true, 
            message: `Connected to MongoDB successfully - Found ${count} total documents.`,
            totalDocuments: count,
            inventoryDocuments: inventoryCount
        });
    } catch (error) {
        console.error('MongoDB connection error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to connect to MongoDB', 
            error: error.message,
            details: error.toString()
        });
    }
});

// Find user document with Inventory key
async function findUserWithInventory() {
    if (!db) {
        throw new Error('Database not connected');
    }
    
    const collection = db.collection(COLLECTION_NAME);
    
    console.log(`Searching for documents with Key="${INVENTORY_KEY}"...`);
    
    // PlayFab structure: look for documents where Key field equals "Inventory"
    let userDocument = await collection.findOne({ 
        Key: INVENTORY_KEY
    });
    
    if (userDocument) {
        console.log(`Found PlayFab document with Key="${INVENTORY_KEY}":`, userDocument._id);
        console.log(`Document structure:`, {
            _id: userDocument._id,
            PlayFabId: userDocument.PlayFabId,
            Key: userDocument.Key,
            hasValue: !!userDocument.Value,
            ValueType: typeof userDocument.Value
        });
        return userDocument;
    }
    
    console.log(`No document found with Key="${INVENTORY_KEY}"`);
    
    // Fallback: Look for any document that has the Inventory key at root level
    userDocument = await collection.findOne({ 
        [INVENTORY_KEY]: { $exists: true } 
    });
    
    if (userDocument) {
        console.log(`Found document with ${INVENTORY_KEY} at root level:`, userDocument._id);
        console.log(`Inventory key type:`, typeof userDocument[INVENTORY_KEY]);
        console.log(`Inventory key structure:`, Object.keys(userDocument[INVENTORY_KEY] || {}));
        return userDocument;
    }
    
    // Try looking in Data object
    userDocument = await collection.findOne({ 
        [`Data.${INVENTORY_KEY}`]: { $exists: true } 
    });
    
    if (userDocument) {
        console.log(`Found document with Data.${INVENTORY_KEY}:`, userDocument._id);
        return userDocument;
    }
    
    console.log(`No document found with Data.${INVENTORY_KEY}`);
    
    // Try alternative search - look for any document with inventory-like data
    const alternatives = await collection.findOne({
        $or: [
            { Key: 'StashData' },
            { Key: 'inventory' },
            { Key: 'Stash' },
            { Key: 'Items' },
            { 'Data.StashData': { $exists: true } },
            { 'Data.inventory': { $exists: true } },
            { 'Data.Stash': { $exists: true } },
            { 'Data.Items': { $exists: true } },
            { 'StashData': { $exists: true } },
            { 'inventory': { $exists: true } },
            { 'Stash': { $exists: true } },
            { 'Items': { $exists: true } }
        ]
    });
    
    if (alternatives) {
        console.log('Found document with alternative inventory keys:', alternatives._id);
        console.log('Root level keys:', Object.keys(alternatives));
        console.log('Data level keys:', Object.keys(alternatives.Data || {}));
        return alternatives;
    }
    
    // If still no luck, get the first document and warn
    userDocument = await collection.findOne({});
    if (userDocument) {
        console.log('Warning: Using first available document, may not contain inventory data');
        console.log('Available root keys:', Object.keys(userDocument));
        console.log('Available Data keys:', Object.keys(userDocument.Data || {}));
    }
    
    return userDocument;
}

// Load inventory from MongoDB
app.get('/api/inventory', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Not connected to database. Please connect first.' 
            });
        }

        console.log(`Looking for user document with "${INVENTORY_KEY}" key...`);
        const userDocument = await findUserWithInventory();

        if (!userDocument) {
            return res.status(404).json({ 
                success: false, 
                message: `No user documents found in collection ${COLLECTION_NAME}` 
            });
        }

        console.log(`Found user document: ${userDocument._id}`);
        console.log('Available root keys:', Object.keys(userDocument));

        let inventory = [];
        let inventorySource = 'none';

        // PlayFab structure: Key="Inventory" and Value contains the JSON
        if (userDocument.Key === INVENTORY_KEY && userDocument.Value) {
            console.log(`Found PlayFab inventory structure, Value type: ${typeof userDocument.Value}`);
            
            if (typeof userDocument.Value === 'string') {
                try {
                    inventory = JSON.parse(userDocument.Value);
                    inventorySource = `PlayFab Key="${INVENTORY_KEY}" Value (parsed JSON string)`;
                    console.log(`Successfully parsed PlayFab inventory, ${inventory.length} items`);
                } catch (parseError) {
                    console.error('Error parsing PlayFab inventory JSON:', parseError);
                    console.log('Raw inventory Value sample:', userDocument.Value.substring(0, 200) + '...');
                    return res.status(500).json({
                        success: false,
                        message: 'Error parsing inventory JSON from PlayFab Value field',
                        error: parseError.message
                    });
                }
            } else if (Array.isArray(userDocument.Value)) {
                inventory = userDocument.Value;
                inventorySource = `PlayFab Key="${INVENTORY_KEY}" Value (direct array)`;
                console.log(`Direct array in PlayFab Value, ${inventory.length} items`);
            }
        }
        // Check if the Inventory key exists at root level (fallback)
        else if (userDocument[INVENTORY_KEY]) {
            const inventoryData = userDocument[INVENTORY_KEY];
            console.log(`Found inventory at root level, type: ${typeof inventoryData}`);
            console.log(`Inventory data keys:`, Object.keys(inventoryData || {}));
            
            // Check if it has a Value property (PlayFab structure)
            if (inventoryData && inventoryData.Value) {
                console.log(`Found .Value property, type: ${typeof inventoryData.Value}`);
                
                if (typeof inventoryData.Value === 'string') {
                    try {
                        inventory = JSON.parse(inventoryData.Value);
                        inventorySource = `Root.${INVENTORY_KEY}.Value (parsed JSON string)`;
                        console.log(`Successfully parsed inventory from .Value property, ${inventory.length} items`);
                    } catch (parseError) {
                        console.error('Error parsing inventory.Value JSON:', parseError);
                        console.log('Raw inventory.Value sample:', inventoryData.Value.substring(0, 200) + '...');
                        return res.status(500).json({
                            success: false,
                            message: 'Error parsing inventory JSON from Value field',
                            error: parseError.message
                        });
                    }
                } else if (Array.isArray(inventoryData.Value)) {
                    inventory = inventoryData.Value;
                    inventorySource = `Root.${INVENTORY_KEY}.Value (direct array)`;
                    console.log(`Direct array in .Value property, ${inventory.length} items`);
                }
            }
            // Fallback: try if it's a direct JSON string
            else if (typeof inventoryData === 'string') {
                try {
                    inventory = JSON.parse(inventoryData);
                    inventorySource = `Root.${INVENTORY_KEY} (parsed JSON string)`;
                    console.log(`Successfully parsed inventory JSON directly, ${inventory.length} items`);
                } catch (parseError) {
                    console.error('Error parsing inventory JSON:', parseError);
                    console.log('Raw inventory data sample:', inventoryData.substring(0, 200) + '...');
                    return res.status(500).json({
                        success: false,
                        message: 'Error parsing inventory JSON',
                        error: parseError.message
                    });
                }
            }
            // Fallback: direct array
            else if (Array.isArray(inventoryData)) {
                inventory = inventoryData;
                inventorySource = `Root.${INVENTORY_KEY} (direct array)`;
                console.log(`Direct array inventory, ${inventory.length} items`);
            }
        }
        // Check Data object
        else if (userDocument.Data && userDocument.Data[INVENTORY_KEY]) {
            const inventoryData = userDocument.Data[INVENTORY_KEY];
            console.log(`Found inventory in Data.${INVENTORY_KEY}, type: ${typeof inventoryData}`);
            
            if (inventoryData && inventoryData.Value && typeof inventoryData.Value === 'string') {
                try {
                    inventory = JSON.parse(inventoryData.Value);
                    inventorySource = `Data.${INVENTORY_KEY}.Value (parsed JSON string)`;
                    console.log(`Successfully parsed inventory from Data.${INVENTORY_KEY}.Value, ${inventory.length} items`);
                } catch (parseError) {
                    console.error('Error parsing Data inventory.Value JSON:', parseError);
                    return res.status(500).json({
                        success: false,
                        message: 'Error parsing inventory JSON from Data.Value field',
                        error: parseError.message
                    });
                }
            }
        }

        console.log(`Final result - Inventory source: ${inventorySource}`);
        console.log(`Final result - Loaded ${inventory.length} items from inventory`);
        
        // Ensure inventory is an array
        if (!Array.isArray(inventory)) {
            console.log('Inventory is not an array, converting...');
            inventory = [];
        }
        
        // Log first few items for debugging
        if (inventory.length > 0) {
            console.log('Sample inventory items:');
            console.log(JSON.stringify(inventory.slice(0, 3), null, 2));
        } else {
            console.log('No inventory items found');
        }

        // Return just the inventory array to maintain compatibility with frontend
        res.json(inventory);
    } catch (error) {
        console.error('Error loading inventory:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load inventory', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Save inventory to MongoDB
app.put('/api/inventory', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Not connected to database' 
            });
        }

        const newInventory = req.body;
        
        if (!Array.isArray(newInventory)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Inventory must be an array' 
            });
        }

        console.log(`Saving ${newInventory.length} items to inventory...`);

        const userDocument = await findUserWithInventory();
        if (!userDocument) {
            return res.status(404).json({ 
                success: false, 
                message: 'No user document found' 
            });
        }

        const collection = db.collection(COLLECTION_NAME);
        
        // Determine where the inventory was originally found and save it there
        let updateData = {};
        let inventoryValue = JSON.stringify(newInventory);
        
        // Check where the inventory exists and maintain the same structure
        if (userDocument.Key === INVENTORY_KEY) {
            // PlayFab structure: update the Value field
            updateData.Value = inventoryValue;
            console.log(`Saving to PlayFab structure: Key="${INVENTORY_KEY}", updating Value field`);
        } else if (userDocument[INVENTORY_KEY]) {
            if (userDocument[INVENTORY_KEY].Value !== undefined) {
                // Maintain PlayFab structure with Value field
                updateData[INVENTORY_KEY] = {
                    ...userDocument[INVENTORY_KEY],
                    Value: inventoryValue
                };
                console.log(`Saving to root level with Value: ${INVENTORY_KEY}.Value`);
            } else {
                // Direct storage
                updateData[INVENTORY_KEY] = inventoryValue;
                console.log(`Saving to root level directly: ${INVENTORY_KEY}`);
            }
        } else if (userDocument.Data && userDocument.Data[INVENTORY_KEY]) {
            if (userDocument.Data[INVENTORY_KEY].Value !== undefined) {
                // Maintain PlayFab structure in Data object
                updateData[`Data.${INVENTORY_KEY}`] = {
                    ...userDocument.Data[INVENTORY_KEY],
                    Value: inventoryValue
                };
                console.log(`Saving to Data object with Value: Data.${INVENTORY_KEY}.Value`);
            } else {
                updateData[`Data.${INVENTORY_KEY}`] = inventoryValue;
                console.log(`Saving to Data object directly: Data.${INVENTORY_KEY}`);
            }
        } else {
            // Default to PlayFab structure
            updateData.Key = INVENTORY_KEY;
            updateData.Value = inventoryValue;
            console.log(`No existing inventory found, creating new PlayFab structure`);
        }
        
        // Add timestamp
        updateData['LastUpdated'] = new Date().toISOString();
        
        // Update the inventory data
        const updateResult = await collection.updateOne(
            { _id: userDocument._id },
            { $set: updateData }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Failed to update user document - document not found' 
            });
        }

        if (updateResult.modifiedCount === 0) {
            console.log('No changes made to document (data was identical)');
        } else {
            console.log(`Inventory saved successfully for user ${userDocument._id}`);
        }

        res.json({ 
            success: true, 
            message: 'Inventory saved successfully',
            itemCount: newInventory.length,
            userId: userDocument._id,
            matchedCount: updateResult.matchedCount,
            modifiedCount: updateResult.modifiedCount
        });
    } catch (error) {
        console.error('Error saving inventory:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to save inventory', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Get user data structure (for debugging)
app.get('/api/user-data', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Not connected to database' 
            });
        }

        const userDocument = await findUserWithInventory();

        if (!userDocument) {
            return res.status(404).json({ 
                success: false, 
                message: `No user document found` 
            });
        }

        // Create detailed structure analysis
        const analyzeObject = (obj, path = '', maxDepth = 3, currentDepth = 0) => {
            if (currentDepth >= maxDepth || !obj || typeof obj !== 'object') {
                return typeof obj;
            }
            
            if (Array.isArray(obj)) {
                return {
                    type: 'array',
                    length: obj.length,
                    sampleItem: obj.length > 0 ? analyzeObject(obj[0], path + '[0]', maxDepth, currentDepth + 1) : null
                };
            }
            
            const result = { type: 'object', properties: {} };
            for (const [key, value] of Object.entries(obj)) {
                if (currentDepth < maxDepth - 1) {
                    result.properties[key] = analyzeObject(value, path + '.' + key, maxDepth, currentDepth + 1);
                } else {
                    result.properties[key] = typeof value;
                }
            }
            return result;
        };

        const structure = {
            _id: userDocument._id,
            hasData: !!userDocument.Data,
            targetInventoryKey: INVENTORY_KEY,
            hasTargetKeyAtRoot: !!userDocument[INVENTORY_KEY],
            hasTargetKeyInData: !!(userDocument.Data && userDocument.Data[INVENTORY_KEY]),
            rootKeys: Object.keys(userDocument),
            dataKeys: userDocument.Data ? Object.keys(userDocument.Data) : [],
            fullStructure: analyzeObject(userDocument)
        };

        // Add specific checks for inventory-like data
        structure.inventoryAnalysis = {};
        
        // Check root level
        for (const [key, value] of Object.entries(userDocument)) {
            if (key.toLowerCase().includes('stash') || 
                key.toLowerCase().includes('inventory') ||
                key.toLowerCase().includes('items') ||
                key === INVENTORY_KEY) {
                
                structure.inventoryAnalysis[`root.${key}`] = {
                    type: typeof value,
                    hasValue: !!(value && value.Value),
                    isArray: Array.isArray(value),
                    valueType: value && value.Value ? typeof value.Value : null,
                    valueLength: value && value.Value && typeof value.Value === 'string' ? value.Value.length : null,
                    directLength: Array.isArray(value) ? value.length : null,
                    sampleData: value && value.Value && typeof value.Value === 'string' ? 
                        value.Value.substring(0, 100) + (value.Value.length > 100 ? '...' : '') : null
                };
            }
        }
        
        // Check Data level
        if (userDocument.Data) {
            for (const [key, value] of Object.entries(userDocument.Data)) {
                if (key.toLowerCase().includes('stash') || 
                    key.toLowerCase().includes('inventory') ||
                    key.toLowerCase().includes('items') ||
                    key === INVENTORY_KEY) {
                    
                    structure.inventoryAnalysis[`data.${key}`] = {
                        type: typeof value,
                        hasValue: !!(value && value.Value),
                        isArray: Array.isArray(value),
                        valueType: value && value.Value ? typeof value.Value : null,
                        valueLength: value && value.Value && typeof value.Value === 'string' ? value.Value.length : null,
                        directLength: Array.isArray(value) ? value.length : null,
                        sampleData: value && value.Value && typeof value.Value === 'string' ? 
                            value.Value.substring(0, 100) + (value.Value.length > 100 ? '...' : '') : null
                    };
                }
            }
        }

        res.json(structure);
    } catch (error) {
        console.error('Error getting user data:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get user data', 
            error: error.message 
        });
    }
});

// List all documents in the collection (for debugging)
app.get('/api/list-users', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Not connected to database' 
            });
        }

        const collection = db.collection(COLLECTION_NAME);
        
        // Get documents that have Key="Inventory" (PlayFab structure)
        const documentsWithPlayFabInventory = await collection.find({ 
            Key: INVENTORY_KEY 
        })
        .limit(10)
        .project({ 
            _id: 1, 
            PlayFabId: 1,
            TitleId: 1,
            Key: 1,
            Value: 1
        })
        .toArray();

        // Get documents that have the Inventory key at root level
        const documentsWithInventory = await collection.find({ 
            [INVENTORY_KEY]: { $exists: true } 
        })
        .limit(10)
        .project({ 
            _id: 1, 
            'Data.PlayFabId': 1,
            'Data.TitleId': 1,
            'Data.UserId': 1,
            [INVENTORY_KEY]: 1
        })
        .toArray();

        // Get documents that have the Inventory key in Data object
        const documentsWithDataInventory = await collection.find({ 
            [`Data.${INVENTORY_KEY}`]: { $exists: true } 
        })
        .limit(10)
        .project({ 
            _id: 1, 
            'Data.PlayFabId': 1,
            'Data.TitleId': 1,
            'Data.UserId': 1
        })
        .toArray();

        // Also get documents with alternative inventory keys
        const documentsWithAlternatives = await collection.find({
            $or: [
                { Key: 'StashData' },
                { Key: 'inventory' },
                { Key: 'Stash' },
                { Key: 'Items' },
                { 'Data.StashData': { $exists: true } },
                { 'Data.inventory': { $exists: true } },
                { 'Data.Stash': { $exists: true } },
                { 'StashData': { $exists: true } },
                { 'inventory': { $exists: true } },
                { 'Stash': { $exists: true } }
            ]
        })
        .limit(5)
        .project({ 
            _id: 1, 
            PlayFabId: 1,
            Key: 1,
            'Data.PlayFabId': 1
        })
        .toArray();

        console.log(`Found ${documentsWithPlayFabInventory.length} documents with PlayFab Key="${INVENTORY_KEY}"`);
        console.log(`Found ${documentsWithInventory.length} documents with root "${INVENTORY_KEY}" key`);
        console.log(`Found ${documentsWithDataInventory.length} documents with "Data.${INVENTORY_KEY}" key`);
        console.log(`Found ${documentsWithAlternatives.length} documents with alternative inventory keys`);

        const playFabUserList = documentsWithPlayFabInventory.map(doc => ({
            _id: doc._id,
            PlayFabId: doc.PlayFabId || 'Unknown',
            TitleId: doc.TitleId || 'Unknown',
            Key: doc.Key,
            hasTargetKey: true,
            location: 'playfab',
            inventoryType: typeof doc.Value,
            inventorySize: typeof doc.Value === 'string' ? doc.Value.length : 'N/A'
        }));

        const rootUserList = documentsWithInventory.map(doc => ({
            _id: doc._id,
            PlayFabId: doc.Data?.PlayFabId || 'Unknown',
            TitleId: doc.Data?.TitleId || 'Unknown',
            UserId: doc.Data?.UserId || 'Unknown',
            hasTargetKey: true,
            location: 'root',
            inventoryType: typeof doc[INVENTORY_KEY],
            inventorySize: typeof doc[INVENTORY_KEY] === 'string' ? doc[INVENTORY_KEY].length : 'N/A'
        }));

        const dataUserList = documentsWithDataInventory.map(doc => ({
            _id: doc._id,
            PlayFabId: doc.Data?.PlayFabId || 'Unknown',
            TitleId: doc.Data?.TitleId || 'Unknown',
            UserId: doc.Data?.UserId || 'Unknown',
            hasTargetKey: true,
            location: 'data'
        }));

        const alternativesList = documentsWithAlternatives.map(doc => ({
            _id: doc._id,
            PlayFabId: doc.PlayFabId || doc.Data?.PlayFabId || 'Unknown',
            Key: doc.Key || 'Data Key',
            hasTargetKey: false,
            location: 'alternative'
        }));

        res.json({
            success: true,
            targetKey: INVENTORY_KEY,
            usersWithPlayFabKey: playFabUserList.length,
            usersWithRootKey: rootUserList.length,
            usersWithDataKey: dataUserList.length,
            usersWithAlternatives: alternativesList.length,
            playFabUsers: playFabUserList,
            rootUsers: rootUserList,
            dataUsers: dataUserList,
            alternatives: alternativesList
        });
    } catch (error) {
        console.error('Error listing users:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to list users', 
            error: error.message 
        });
    }
});

// Get balance
app.get('/api/balance', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ success: false, message: 'Not connected to database' });
        }

        const userDocument = await findUserWithInventory();
        if (!userDocument) {
            return res.status(404).json({ success: false, message: 'No user document found' });
        }

        // Look for Balance key
        let balance = { AU: 0, SC: 0, IN: 0 };
        
        if (userDocument.Key === 'Balance' && userDocument.Value) {
            balance = typeof userDocument.Value === 'string' ? JSON.parse(userDocument.Value) : userDocument.Value;
        } else {
            // Look for balance in other locations
            const collection = db.collection(COLLECTION_NAME);
            const balanceDoc = await collection.findOne({ Key: 'Balance' });
            if (balanceDoc && balanceDoc.Value) {
                balance = typeof balanceDoc.Value === 'string' ? JSON.parse(balanceDoc.Value) : balanceDoc.Value;
            }
        }

        res.json(balance);
    } catch (error) {
        console.error('Error loading balance:', error);
        res.status(500).json({ success: false, message: 'Failed to load balance', error: error.message });
    }
});

// Save balance
app.put('/api/balance', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ success: false, message: 'Not connected to database' });
        }

        const newBalance = req.body;
        const collection = db.collection(COLLECTION_NAME);
        
        // Try to find existing balance document
        let balanceDoc = await collection.findOne({ Key: 'Balance' });
        
        if (balanceDoc) {
            // Update existing
            await collection.updateOne(
                { _id: balanceDoc._id },
                { $set: { Value: JSON.stringify(newBalance), LastUpdated: new Date().toISOString() } }
            );
        } else {
            // Create new balance document
            await collection.insertOne({
                Key: 'Balance',
                Value: JSON.stringify(newBalance),
                LastUpdated: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Balance saved successfully' });
    } catch (error) {
        console.error('Error saving balance:', error);
        res.status(500).json({ success: false, message: 'Failed to save balance', error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        connected: !!db,
        timestamp: new Date().toISOString(),
        config: {
            mongoUrl: MONGO_URL.replace(/\/\/.*@/, '//***:***@'), // Hide credentials
            database: DB_NAME,
            collection: COLLECTION_NAME,
            inventoryKey: INVENTORY_KEY
        }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down server...');
    if (client) {
        await client.close();
        console.log('MongoDB connection closed');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (client) {
        await client.close();
        console.log('MongoDB connection closed');
    }
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('='.repeat(50));
    console.log('The Cycle: Frontier Save Editor Backend');
    console.log('='.repeat(50));
    console.log('Target MongoDB Configuration:');
    console.log(`  URL: ${MONGO_URL}`);
    console.log(`  Database: ${DB_NAME}`);
    console.log(`  Collection: ${COLLECTION_NAME}`);
    console.log(`  Looking for key: "${INVENTORY_KEY}"`);
    console.log('');
    console.log('📝 This system will automatically find any user document');
    console.log(`   that contains the "${INVENTORY_KEY}" key.`);
    console.log('   No need to specify a specific ObjectID!');
    console.log('');
    console.log('Available Endpoints:');
    console.log('  POST /api/connect     - Connect to MongoDB');
    console.log('  GET  /api/inventory   - Load inventory');
    console.log('  PUT  /api/inventory   - Save inventory');
    console.log('  GET  /api/user-data   - Get user data structure');
    console.log('  GET  /api/list-users  - List users with inventory data');
    console.log('  GET  /api/health      - Health check');
    console.log('='.repeat(50));
    console.log('Open http://localhost:3000 in your browser to start');
    console.log('');
});

module.exports = app;