
const Discord = require("discord.js-selfbot-v13")
const client = new Discord.Client({
    checkUpdate: false
});
const express = require('express');
const {
    solveHint,
    checkRarity
} = require("pokehint")

const config = require('./config.json')
const allowedChannels = []; // Add your allowed channel IDs to this array or leave it like [] if you want to it to catch from all channels
let isSleeping = false;

// Enhanced memory management
let activeSpawns = new Map(); // Track active spawns per channel
let hintTimeouts = new Map(); // Track hint request timeouts
let catchTimeouts = new Map(); // Track catch attempt timeouts

// Smart spam tracking variables
let lastSpawnTime = Date.now();
let consecutiveNoSpawns = 0;
let totalSpawns = 0;
let startTime = Date.now();

//------------------------- KEEP-ALIVE--------------------------------//

const app = express();
if (Number(process.version.slice(1).split(".")[0]) < 8) throw new Error("Node 8.0.0 or higher is required. Update Node on your system.");
app.get("/", (req, res) => {
    res.status(200).send({
        success: "true"
    });
});
app.listen(process.env.PORT || 3000);

//--------------------------------------------------------------//

//-------------------------ENHANCED MEMORY MANAGEMENT----------------------------//

// Function to completely clear channel state
function clearChannelState(channelId) {
    console.log(`🧹 Clearing all state for channel ${channelId}`);
    
    // Clear active spawn data
    activeSpawns.delete(channelId);
    
    // Clear and cancel any pending timeouts
    if (hintTimeouts.has(channelId)) {
        clearTimeout(hintTimeouts.get(channelId));
        hintTimeouts.delete(channelId);
    }
    
    if (catchTimeouts.has(channelId)) {
        clearTimeout(catchTimeouts.get(channelId));
        catchTimeouts.delete(channelId);
    }
    
    console.log(`✅ Channel ${channelId} state cleared completely`);
}

// Function to handle new spawn detection
function handleNewSpawn(channel, messageId) {
    const channelId = channel.id;
    
    // Clear any previous state for this channel
    clearChannelState(channelId);
    
    // Create new spawn entry
    const spawnData = {
        messageId: messageId,
        spawnTime: Date.now(),
        hintRequested: false,
        hintReceived: false,
        catchAttempted: false,
        pokemonName: null
    };
    
    activeSpawns.set(channelId, spawnData);
    console.log(`🆕 New spawn detected in channel ${channelId}, requesting hint...`);
    
    // Request hint with 2-3 second delay
    const hintDelay = Math.floor(Math.random() * 1000) + 2000; // 2-3 seconds
    const hintTimeout = setTimeout(async () => {
        const currentSpawn = activeSpawns.get(channelId);
        if (currentSpawn && !currentSpawn.hintRequested) {
            try {
                await channel.send(`<@716390085896962058> h`);
                currentSpawn.hintRequested = true;
                console.log(`🔍 Hint requested for spawn ${messageId} after ${hintDelay}ms`);
            } catch (error) {
                console.error("Error requesting hint:", error);
                clearChannelState(channelId);
            }
        }
    }, hintDelay);
    
    hintTimeouts.set(channelId, hintTimeout);
    
    // Set timeout to clear spawn if no hint received within 30 seconds
    setTimeout(() => {
        const currentSpawn = activeSpawns.get(channelId);
        if (currentSpawn && !currentSpawn.hintReceived) {
            console.log(`⏰ Timeout: No hint received for spawn ${messageId}, clearing state`);
            clearChannelState(channelId);
        }
    }, 30000);
}

// Function to handle hint response
async function handleHintResponse(message) {
    const channelId = message.channel.id;
    const currentSpawn = activeSpawns.get(channelId);
    
    if (!currentSpawn) {
        console.log(`⚠️ Received hint but no active spawn for channel ${channelId}`);
        return;
    }
    
    if (currentSpawn.hintReceived) {
        console.log(`⚠️ Hint already processed for current spawn, ignoring`);
        return;
    }
    
    // Mark hint as received
    currentSpawn.hintReceived = true;
    currentSpawn.hintTime = Date.now();
    
    console.log(`🎯 Processing hint: ${message.content}`);
    
    try {
        const pokemon = await solveHint(message);
        if (!pokemon || !pokemon[0]) {
            throw new Error("Could not solve hint");
        }
        
        // Store pokemon name
        currentSpawn.pokemonName = pokemon[0];
        console.log(`✅ Hint solved: ${pokemon[0]}`);
        
        // Schedule catch attempt for exactly 3 seconds from now
        const catchDelay = 3000;
        console.log(`⚡ Scheduling catch in ${catchDelay}ms...`);
        
        const catchTimeout = setTimeout(async () => {
            const latestSpawn = activeSpawns.get(channelId);
            
            // Double-check this is still the same spawn
            if (latestSpawn && latestSpawn.messageId === currentSpawn.messageId && !latestSpawn.catchAttempted) {
                try {
                    latestSpawn.catchAttempted = true;
                    await message.channel.send(`<@716390085896962058> c ${pokemon[0]}`);
                    console.log(`🎣 Catch attempt sent: ${pokemon[0]}`);
                    
                    // Log to channel
                    const logChannel = client.channels.cache.get(config.logChannelID);
                    if (logChannel) {
                        let rarity;
                        try {
                            rarity = await checkRarity(pokemon[0]);
                        } catch {
                            rarity = "Not Found in Database";
                        }
                        logChannel.send(`[${message.guild.name}/#${message.channel.name}] **__${pokemon[0]}__** Rarity ${rarity} made by 🔥⃤•AK_ØPᵈᵉᵛ✓#6326`);
                    }
                    
                } catch (error) {
                    console.error("Error sending catch command:", error);
                    clearChannelState(channelId);
                }
            } else {
                console.log(`⚠️ Spawn state changed, skipping catch attempt`);
            }
        }, catchDelay);
        
        catchTimeouts.set(channelId, catchTimeout);
        
    } catch (error) {
        console.error("Error solving hint:", error);
        clearChannelState(channelId);
    }
}

// Function to handle catch result
function handleCatchResult(message, success = false) {
    const channelId = message.channel.id;
    const currentSpawn = activeSpawns.get(channelId);
    
    if (success) {
        console.log(`🎉 Successful catch! Clearing state for channel ${channelId}`);
    } else {
        console.log(`❌ Wrong Pokemon caught in channel ${channelId}, clearing state`);
    }
    
    // Always clear state after catch result
    clearChannelState(channelId);
}

function checkSpawnsRemaining(string) {
    const match = string.match(/Spawns Remaining: (\d+)/);
    if (match) {
        const spawnsRemaining = parseInt(match[1]);
        console.log(spawnsRemaining)
    }
}

// Function to update spawn tracking
function updateLastSpawnTime() {
    lastSpawnTime = Date.now();
    consecutiveNoSpawns = 0;
    totalSpawns++;
    
    // Log spawn rate statistics every 10 spawns
    if (totalSpawns % 10 === 0) {
        const timeRunning = (Date.now() - startTime) / 1000 / 60; // minutes
        const spawnRate = totalSpawns / timeRunning;
        console.log(`📊 Spawn Statistics: ${totalSpawns} spawns in ${timeRunning.toFixed(1)} minutes (${spawnRate.toFixed(2)} spawns/min)`);
    }
}

// Function to safely send error messages
function sendErrorToChannel(error) {
    try {
        const channel = client.channels.cache.get(config.errorChannelID);
        if (channel) {
            channel.send(`Error: ${error.message || error}`).catch(err => {
                console.log("Failed to send error to channel:", err);
            });
        } else {
            console.log("Error channel not found or not configured");
        }
    } catch (err) {
        console.log("Error in sendErrorToChannel:", err);
    }
}

//--------------------------------------------------------------------------//

//-------------------------READY HANDLER+OPTIMIZED SPAMMER-----------------------//

client.on('ready', () => {
    console.log(`Account: ${client.user.username} is ONLINE with HINT BASED DETECTION`)
    console.log("Note: When your using Incense then make sure it occurs in a separate channel where hint bots like pokename/sierra aren't enabled to send message there!")
    console.log("Use $help to know about commands")
    console.log("🚀 OPTIMIZATION: Hint-based detection enabled - No OCR needed!")
    console.log("⚡ SPEED: Modified for 3 second catch speed!")
    console.log("🧠 MEMORY: Enhanced state management - No duplicate catches!")
    console.log("✨ FIXED: Memory cleared after each spawn/catch cycle!")

    const channel = client.channels.cache.get(config.spamChannelID)

    function getRandomInterval(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Basic optimized spam
    function basicOptimizedSpam() {
        const result = Math.random().toString(36).substring(2, 15);
        channel.send(result + "(Made by unknown) ")
        
        // Optimized interval: 500ms to 1.5 seconds
        const randomInterval = getRandomInterval(500, 1500);
        setTimeout(basicOptimizedSpam, randomInterval);
    }

    basicOptimizedSpam();
})

//------------------------------------------------------------//

//-------------------------Anti-Crash-------------------------//

process.on("unhandledRejection", (reason, p) => {
    if (reason == "Error: Unable to identify that pokemon.") {} else {
        console.log(" [antiCrash] :: Unhandled Rejection/Catch");
        console.log(reason, p);
    }
});
process.on("uncaughtException", (err, origin) => {
    console.log(" [antiCrash] :: Uncaught Exception/Catch");
    console.log(err, origin);
});
process.on("uncaughtExceptionMonitor", (err, origin) => {
    console.log(" [antiCrash] :: Uncaught Exception/Catch (MONITOR)");
    console.log(err, origin);
});
process.on("multipleResolves", (type, promise, reason) => {
    console.log(" [antiCrash] :: Multiple Resolves");
    console.log(type, promise, reason);
});

//------------------------------------------------------------//

//----------------------------AUTOCATCHER--------------------------------------//

client.on('messageCreate', async message => {
    if (message.content === "$captcha_completed" && message.author.id === config.OwnerID) {
        isSleeping = false;
        // Clear all states when restarting
        activeSpawns.clear();
        hintTimeouts.clear();
        catchTimeouts.clear();
        message.channel.send("🚀 Autocatcher Started with ENHANCED HINT BASED detection! ⚡ 3 second catch speed enabled!")
    }

    if (message.content === "$help" && message.author.id === config.OwnerID) {
        await message.channel.send(
            "``` Poketwo-Autocatcher - ENHANCED HINT BASED VERSION (3 Second Catch Speed)\n Link: https://github.com/AkshatOP/Poketwo-Autocatcher\n\n $captcha_completed : Use to restart the bot once captcha is solved\n $say <content> : Make the bot say whatever you want\n $react <messageID> : React with ✅ emoji\n $click <messageID> : Clicks the button which has ✅ emoji\n $stats : Show spawn statistics\n $debug : Show active spawns debug info\n $help : To show this message\n\n 🚀 OPTIMIZATIONS:\n - Enhanced hint-based detection\n - Smart spawn state management\n - No duplicate catch attempts\n ⚡ SPEED MODIFICATIONS:\n - 3 second catch delay\n - 2-3 second hint request delay\n 🧠 MEMORY MANAGEMENT:\n - Complete state clearing after each spawn\n - No old hint retention\n - Timeout-based cleanup\n ✨ FIXES:\n - No more catching previous Pokemon\n - Proper spawn cycle management ```"
        )
    }

    if (message.content === "$stats" && message.author.id === config.OwnerID) {
        const timeRunning = (Date.now() - startTime) / 1000 / 60; // minutes
        const spawnRate = totalSpawns / timeRunning;
        const timeSinceLastSpawn = (Date.now() - lastSpawnTime) / 1000 / 60; // minutes
        
        await message.channel.send(
            `📊 **Spawn Statistics**\n` +
            `Total Spawns: ${totalSpawns}\n` +
            `Runtime: ${timeRunning.toFixed(1)} minutes\n` +
            `Spawn Rate: ${spawnRate.toFixed(2)} spawns/minute\n` +
            `Time since last spawn: ${timeSinceLastSpawn.toFixed(1)} minutes\n` +
            `Active spawns: ${activeSpawns.size}\n` +
            `⚡ Catch Speed: 3 seconds`
        )
    }

    if (message.content === "$debug" && message.author.id === config.OwnerID) {
        let debugInfo = "🔍 **Debug Information**\n";
        debugInfo += `Active spawns: ${activeSpawns.size}\n`;
        debugInfo += `Hint timeouts: ${hintTimeouts.size}\n`;
        debugInfo += `Catch timeouts: ${catchTimeouts.size}\n`;
        
        if (activeSpawns.size > 0) {
            debugInfo += "\n**Active Spawn Details:**\n";
            for (const [channelId, spawn] of activeSpawns) {
                const age = ((Date.now() - spawn.spawnTime) / 1000).toFixed(1);
                debugInfo += `Channel ${channelId}: ${spawn.pokemonName || 'Unknown'} (${age}s old)\n`;
                debugInfo += `  - Hint requested: ${spawn.hintRequested}\n`;
                debugInfo += `  - Hint received: ${spawn.hintReceived}\n`;
                debugInfo += `  - Catch attempted: ${spawn.catchAttempted}\n`;
            }
        }
        
        await message.channel.send(debugInfo);
    }

    if (!isSleeping) {

        if (message.content.includes("Please tell us") && message.author.id === "716390085896962058") {
            isSleeping = true;
            // Clear all states when captcha detected
            activeSpawns.clear();
            hintTimeouts.clear();
            catchTimeouts.clear();
            message.channel.send("⚠️ Autocatcher Stopped , Captcha Detected! Use `$captcha_completed` once the captcha is solved ");
            setTimeout(async function() {
                isSleeping = false
            }, 18000000) //5 hours

        } else if (message.content.startsWith("$say") && message.author.id == config.OwnerID) {
            let say = message.content.split(" ").slice(1).join(" ")
            message.channel.send(say)

        } else if (message.content.startsWith("$react") && message.author.id == config.OwnerID) {
            let msg
            try {
                const args = message.content.slice(1).trim().split(/ +/g)
                msg = await message.channel.messages.fetch(args[1])
            } catch (err) {
                message.reply(`Please Specify the message ID as an arguement like "$react <messageID>"`)
            }
            if (msg) {
                try {
                    msg.react("✅")
                    message.react("✅")
                } catch (err) {
                    message.react("❌")
                    console.log(err)
                }
            }

        } else if (message.content.startsWith("$click") && message.author.id == config.OwnerID) {

            let msg
            try {
                var args = message.content.slice(1).trim().split(/ +/g)
                msg = await message.channel.messages.fetch(args[1])
            } catch (err) {
                message.reply(`Please Specify the message ID as an arguement like "$click <messageID>".`)
            }

            if (msg) {
                try {
                    await msg.clickButton();
                    message.react("✅")
                } catch (err) {
                    message.react("❌")
                    console.log(err)
                }
            }
        } else if (message.content == "That is the wrong pokémon!" && message.author.id == "716390085896962058") {
            // Handle wrong catch - clear state and don't request new hint
            handleCatchResult(message, false);
            updateLastSpawnTime();

        } else if (message.content.includes("Congratulations") && message.author.id == "716390085896962058") {
            // Handle successful catch
            handleCatchResult(message, true);

        } else if (message.author.id == "716390085896962058") {
            if (message?.embeds[0]?.footer?.text.includes("Spawns Remaining")) {
                // Handle incense spawn
                updateLastSpawnTime();
                handleNewSpawn(message.channel, message.id);
                
                if ((message.embeds[0]?.footer?.text == "Incense: Active.\nSpawns Remaining: 0.")) {
                    message.channel.send(`<@716390085896962058> buy incense`)
                }

            } else if (message.content.includes("The pokémon is")) {
                // Handle hint response
                updateLastSpawnTime();
                await handleHintResponse(message);
            }

        } else {
            // Check for Pokemon spawns from other bots or regular poketwo spawns
            const Pokebots = ["696161886734909481", "874910942490677270", "716390085896962058"]; // sierra, pokename, poketwo
            if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel.id)) {
                return;
            }
            
            if (Pokebots.includes(message.author.id)) {
                // Check if this is a pokemon spawn (has embeds with images)
                let hasSpawnImage = false;
                if (message.embeds && message.embeds.length > 0) {
                    message.embeds.forEach((embed) => {
                        if (embed.image && embed.image.url) {
                            // Check if it's a pokemon spawn image (not a profile or other image)
                            const imageURL = embed.image.url;
                            if (imageURL.includes('pokemon') || 
                                imageURL.includes('sprites') || 
                                imageURL.includes('embed.png') ||
                                imageURL.includes('prediction.png')) {
                                hasSpawnImage = true;
                            }
                        }
                    });
                }
                
                // If it's a spawn, handle it
                if (hasSpawnImage) {
                    updateLastSpawnTime();
                    handleNewSpawn(message.channel, message.id);
                }
            }
        }
    }
})

client.login(config.TOKEN) //use process.env.TOKEN if you are using it in repl.it