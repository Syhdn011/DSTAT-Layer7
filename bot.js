const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const cron = require('node-cron');

const bot = new Telegraf('', {
    telegram: { 
        agent: new https.Agent({ family: 4 })
    }
});

const DATA_FILE = path.join(__dirname, 'ongoing_session.json');
const HISTORY_FILE = path.join(__dirname, 'session_history.json');
const USERS_FILE = path.join(__dirname, 'users.json');
let ongoingSession = null;
let sessionQueue = [];

// Fungsi untuk membuat path yang aman
function generateSecurePath() {
    return `/target_${crypto.randomBytes(16).toString('hex')}`;
}

// Fungsi untuk menyimpan data sesi ke riwayat
function saveSessionToHistory(sessionData) {
    try {
        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE));
        }
        history.push(sessionData);

        // Simpan kembali ke file dengan data terbaru
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('Error saving session to history:', error);
    }
}

// Fungsi untuk menyimpan sesi aktif ke file (opsional jika ingin persisten)
function saveSessionToFile() {
    try {
        if (ongoingSession) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(ongoingSession, null, 2));
        } else if (fs.existsSync(DATA_FILE)) {
            fs.unlinkSync(DATA_FILE); // Hapus file jika tidak ada sesi aktif
        }
    } catch (error) {
        console.error('Error saving session to file:', error);
    }
}

// Fungsi untuk menyimpan daftar pengguna
function saveUserToFile(userId) {
    try {
        let users = [];
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE));
        }
        if (!users.includes(userId)) {
            users.push(userId);
            fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        }
    } catch (error) {
        console.error('Error saving user to file:', error);
    }
}

// Fungsi untuk mengakhiri sesi dan mengirimkan laporan
function endSession(ctx) {
    try {
        if (ongoingSession) {
            const resultFilePath = path.join(__dirname, `${ongoingSession.userId}_requests.json`);
            const data = {
                ID: ongoingSession.userId,
                Path: ongoingSession.path,
                TotalRequest: ongoingSession.requestCount,
                StartTime: new Date(ongoingSession.startTime).toLocaleString(),
                EndTime: new Date().toLocaleString(),
                Username: ctx.from.username
            };

            fs.writeFileSync(resultFilePath, JSON.stringify(data, null, 2));
            saveSessionToHistory(data);

            const message = `
🔔 Total Traffic Overview 🔔
------------------------------
📊 Metric Statistics:
${data.TotalRequest > 0 ? `• Total Requests: ${data.TotalRequest}` : `➥ No data found`}
Data From: ${ctx.from.username}
            `;
            ctx.reply(message);

            // Clear the ongoing session
            ongoingSession = null;
            saveSessionToFile();

            // Check if there is another session in the queue
            if (sessionQueue.length > 0) {
                const nextSession = sessionQueue.shift();
                startSession(nextSession.ctx);
            }
        }
    } catch (error) {
        console.error('Error ending session:', error);
        ctx.reply('Terjadi kesalahan saat mengakhiri sesi.');
    }
}

// Fungsi untuk memulai interval pembaruan sesi
function startSessionUpdateInterval(ctx) {
    const intervalTime = 5000; // Update setiap 5 detik
    let previousMessageId = null; // Variabel untuk menyimpan ID pesan sebelumnya

    const interval = setInterval(async () => {
        if (!ongoingSession) {
            clearInterval(interval);
            return;
        }
        const remainingTime = ongoingSession.duration - (Date.now() - ongoingSession.startTime);

        // Hapus pesan sebelumnya jika ada
        if (previousMessageId) {
            try {
                await ctx.deleteMessage(previousMessageId);
            } catch (error) {
                console.error('Gagal menghapus pesan sebelumnya:', error);
            }
        }

        // Kirim pesan pembaruan sesi
        const sentMessage = await ctx.reply(`
🔔 Session Update 🔔
------------------------------
📊 Current Requests: ${ongoingSession.requestCount}
⏳ Remaining Time: ${Math.round(remainingTime / 1000)} seconds
Data From: ${ctx.from.username}
        `);

        // Simpan ID pesan yang baru dikirim
        previousMessageId = sentMessage.message_id;

        if (remainingTime <= 0) {
            clearInterval(interval);
            endSession(ctx);
        }
    }, intervalTime); 
}

// Fungsi untuk memulai sesi
async function startSession(ctx) {
    try {
        const userPath = generateSecurePath();
        ongoingSession = {
            userId: ctx.from.id,
            path: userPath,
            requestCount: 0,
            startTime: Date.now(),
            duration: 200000,  // Durasi sesi dalam milidetik (200 detik)
            domain: 'https://zenanetwork.site'
        };

        saveUserToFile(ctx.from.id); // Simpan pengguna yang memulai sesi
        await saveSessionToFile();

        ctx.reply(`
🚀 #8 - Protected with Cloudflare ( WAF ) (100K) 🚀
------------------------------
📊 Statistics have started
🎯 Target: ${ongoingSession.domain}${userPath}
⏳ Duration: ${ongoingSession.duration / 1000} seconds
🚗 Started by: ${ctx.from.username}
        `);

        startSessionUpdateInterval(ctx);
    } catch (error) {
        console.error('Error starting session:', error);
        ctx.reply('Terjadi kesalahan saat memulai sesi.');
    }
}

// Perintah /start untuk memulai sesi
bot.start((ctx) => {
    ctx.reply('Selamat datang! Gunakan perintah /menu untuk melihat opsi yang tersedia.', Markup.keyboard([
        ['/rank', '/start'], 
        ['/menu']
    ]).resize().oneTime());
});

// Perintah /menu untuk menampilkan menu pilihan
bot.command('menu', (ctx) => {
    ctx.reply('Pilih opsi:', Markup.inlineKeyboard([
        [Markup.button.callback('Ranking', 'rank')],
        [Markup.button.callback('Mulai Sesi', 'start_session')],
        [Markup.button.callback('Akhiri Sesi', 'end_session')]
    ]));
});

// Menangani klik pada tombol inline "Ranking"
bot.action('rank', (ctx) => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const history = JSON.parse(fs.readFileSync(HISTORY_FILE));

            // Urutkan berdasarkan TotalRequest terbesar
            history.sort((a, b) => b.TotalRequest - a.TotalRequest);

            let rankingMessage = '🏆 Session Ranking 🏆\n------------------------------\n';
            history.slice(0, 5).forEach((session, index) => {
                rankingMessage += `${index + 1}. ${session.Username} - ${session.TotalRequest} requests\n`;
            });

            ctx.reply(rankingMessage);
        } else {
            ctx.reply('Belum ada sesi yang disimpan.');
        }
    } catch (error) {
        console.error('Error fetching rank:', error);
        ctx.reply('Terjadi kesalahan saat menampilkan peringkat.');
    }
});

// Menangani klik pada tombol inline "Mulai Sesi"
bot.action('start_session', (ctx) => {
    if (ongoingSession) {
        ctx.reply('Pengguna lain sedang menggunakan bot. Anda telah dimasukkan ke dalam antrian.');
        sessionQueue.push({ ctx });
    } else {
        startSession(ctx);
    }
});

// Menangani klik pada tombol inline "Akhiri Sesi"
bot.action('end_session', (ctx) => {
    if (ongoingSession && ongoingSession.userId === ctx.from.id) {
        endSession(ctx);
        ctx.reply('Sesi telah diakhiri oleh pengguna.');
    } else {
        ctx.reply('Tidak ada sesi aktif atau Anda bukan pengguna yang memulai sesi.');
    }
});

// Inisialisasi server Express
const app = express();
const PORT = 80;  // Menggunakan port dari .env atau port HTTP standar

// Middleware untuk parsing permintaan JSON
app.use(express.json());

// Route untuk menangani permintaan Layer7 yang masuk
app.get('*', (req, res) => {
    console.log('Incoming request:', req.path);
    if (!ongoingSession) {
        res.status(403).send('Tidak ada sesi aktif');
        return;
    }

    console.log('Ongoing session path:', ongoingSession.path);

    const requestedPath = req.path;

    if (requestedPath === ongoingSession.path) {
        ongoingSession.requestCount++;
        saveSessionToFile();
        res.status(200).send('Permintaan diterima');
    } else {
        res.status(403).send('Path tidak valid.');
    }
});

// Route untuk mendapatkan status sesi saat ini
app.get('/status', (req, res) => {
    if (ongoingSession) {
        res.status(200).json({
            status: "active",
            userId: ongoingSession.userId,
            path: ongoingSession.path,
            requestCount: ongoingSession.requestCount,
            startTime: new Date(ongoingSession.startTime).toLocaleString(),
            remainingTime: (ongoingSession.duration - (Date.now() - ongoingSession.startTime)) / 1000
        });
    } else {
        res.status(200).json({ status: "no active session" });
    }
});

// Jalankan server Express
app.listen(PORT, () => {
    console.log(`Server berjalan pada https://zenanetwork.site:${PORT}`);
});

// Jalankan bot Telegram
bot.launch();

// Tugas terjadwal untuk mereset peringkat setiap hari pada jam 00:00
cron.schedule('0 0 * * *', () => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify([])); // Reset file riwayat
            console.log('Ranking telah direset.');

            // Kirim pesan ke semua pengguna yang telah menggunakan bot
            if (fs.existsSync(USERS_FILE)) {
                const users = JSON.parse(fs.readFileSync(USERS_FILE));
                users.forEach(userId => {
                    bot.telegram.sendMessage(userId, 'Peringkat harian telah direset. Ayo mulai sesi baru dan capai peringkat teratas!');
                });
            }
        }
    } catch (error) {
        console.error('Error resetting ranking:', error);
    }
});
