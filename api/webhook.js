// ==========================================
// 1. PENGATURAN UTAMA (MODE BOT CADANGAN / TEST)
// ==========================================
const ADMIN_USERNAME = "Fellstore1"; // Tanpa tanda @[span_0](start_span)[span_0](end_span)
const LINK_CH_CADANGAN = "https://t.me/+OGXaaPyrnd5kMmY1"; //[span_1](start_span)[span_1](end_span)
const LINK_CH_FREE = "https://t.me/+jf3tLqLIG444MjBI"; //[span_2](start_span)[span_2](end_span)

const REDIS_KEY = "test_lumine_miniset_katalog";
const REDIS_BUNDLE_KEY = "test_lumine_miniset_bundle";
const REDIS_QRIS_KEY = "test_lumine_miniset_qris";
const REDIS_ORDER_SEQ_KEY = "test_lumine_miniset_order_seq";
const REDIS_ORDER_PREFIX = "test_lumine_order_";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ==========================================
// 2. FUNGSI DATABASE (UPSTASH REDIS REST API)
// ==========================================
async function redisCommand(commandArray) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Variabel database Redis belum terhubung di Vercel.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandArray),
  });

  const data = await res.json();
  return data.result;
}

async function getKatalog() {
  const raw = await redisCommand(["GET", REDIS_KEY]);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveKatalog(list) {
  await redisCommand(["SET", REDIS_KEY, JSON.stringify(list)]);
}

async function getBundle() {
  const raw = await redisCommand(["GET", REDIS_BUNDLE_KEY]);
  if (!raw) return { link: "" };
  try {
    return JSON.parse(raw);
  } catch {
    return { link: "" };
  }
}

async function saveBundle(bundleData) {
  await redisCommand(["SET", REDIS_BUNDLE_KEY, JSON.stringify(bundleData)]);
}

async function getQris() {
  const raw = await redisCommand(["GET", REDIS_QRIS_KEY]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveQris(qrisData) {
  await redisCommand(["SET", REDIS_QRIS_KEY, JSON.stringify(qrisData)]);
}

async function getOrder(orderId) {
  const raw = await redisCommand(["GET", `${REDIS_ORDER_PREFIX}${orderId}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveOrder(orderId, orderData) {
  await redisCommand([
    "SET",
    `${REDIS_ORDER_PREFIX}${orderId}`,
    JSON.stringify(orderData),
    "EX",
    "172800",
  ]);
}

function parseNominal(hargaStr) {
  const angka = parseInt(String(hargaStr || "").replace(/\D/g, ""), 10);
  return angka && angka >= 100 ? angka : 2000;
}

function formatRupiah(angka) {
  return "Rp " + Number(angka).toLocaleString("id-ID");
}

async function createOrder(user, itemNama, baseNominal, targetLink) {
  const orderId = await redisCommand(["INCR", REDIS_ORDER_SEQ_KEY]);
  const kodeUnik = ((orderId - 1) % 299) + 1; // Kode unik berurutan +1 s/d +299 (anti-bentrok)
  const totalNominal = baseNominal + kodeUnik;

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Pembeli";
  const orderData = {
    id: orderId,
    buyer_id: user.id,
    buyer_name: fullName,
    buyer_username: user.username ? `@${user.username}` : "Tanpa Username",
    item_nama: itemNama,
    base_nominal: baseNominal,
    kode_unik: kodeUnik,
    total_nominal: totalNominal,
    target_link: targetLink,
    status: "pending",
  };

  await saveOrder(orderId, orderData);
  return orderData;
}

// ==========================================
// 3. HELPER TELEGRAM API & KEYBOARD
// ==========================================
async function tgRequest(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function getMainMenu() {
  return {
    keyboard: [
      [{ text: "🛍️ Katalog Mini Set" }, { text: "🎁 Promo Bundling 5k" }],
      [{ text: "📋 Cara Beli & Aturan" }, { text: "💎 Upgrade CH Utama" }],
      [{ text: "🔗 Channel Lainnya" }],
    ],
    resize_keyboard: true,
  };
}

function buildKatalogKeyboard(katalogList) {
  return {
    inline_keyboard: katalogList.map((item) => [
      {
        text: `📸 ${item.nama} (${item.harga})`,
        callback_data: `detail_${item.id}`,
      },
    ]),
  };
}

function normalizeUrl(rawUrl) {
  const clean = rawUrl.trim();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    return `https://${clean}`;
  }
  return clean;
}

async function sendPromoBundling(token, chatId, replyToMessageId = null) {
  const bundle = await getBundle();
  const promoText =
    "🎁 <b>PROMO BUNDLING HEMAT — 2 MINI SET CUMA Rp 5.000!</b>\n\n" +
    "Mau koleksi lebih dari satu set tapi tetap hemat?\n" +
    "• Harga normal 2 Mini Set : <s>Rp 6.000</s>\n" +
    "• Harga Promo Bundling : <b>Rp 5.000</b> <i>(Hemat Rp 1.000!)</i>\n\n" +
    "📌 <b>Cara Klaim Promo:</b>\n" +
    "1. Cek judul 2 set yang kamu mau di menu <b>🛍️ Katalog Mini Set</b>.\n" +
    "2. Klik tombol <b>Beli Promo</b> di bawah untuk scan QRIS dengan kode unik.\n" +
    "3. Setelah admin ACC, link akses langsung dikirim ke chat ini!";

  const buttons = [];
  if (bundle.link && bundle.link.trim() !== "") {
    buttons.push([
      {
        text: "⚡ Beli Promo 2 Mini Set (Rp 5.000)",
        callback_data: "buy_bundle",
      },
    ]);
  }
  buttons.push([
    {
      text: `💬 Tanya Admin (@${ADMIN_USERNAME})`,
      url: `https://t.me/${ADMIN_USERNAME}`,
    },
  ]);

  const payload = {
    chat_id: chatId,
    text: promoText,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  await tgRequest(token, "sendMessage", payload);
}

// ==========================================
// 4. HANDLER UTAMA SERVERLESS VERCEL
// ==========================================
module.exports = async function handler(req, res) {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "BOT_TOKEN belum diisi di Vercel." });
  }

  if (req.method === "GET") {
    if (req.query.setup === "true") {
      const webhookUrl = `https://${req.headers.host}/api/webhook`;
      const result = await tgRequest(token, "setWebhook", { url: webhookUrl });
      return res.status(200).json({
        status: "Webhook berhasil diatur",
        webhook_url: webhookUrl,
        database_connected: Boolean(
          (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
            (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
        ),
        telegram_response: result,
      });
    }
    return res.status(200).send("Bot Lumine Photopack | Mini Set (Test) Aktif!");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const update =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    // ------------------------------------------
    // A. HANDLER KLIK TOMBOL INLINE (KATALOG, QRIS, ACC)
    // ------------------------------------------
    if (update.callback_query) {
      const call = update.callback_query;
      const chatId = call.message.chat.id;
      const messageId = call.message.message_id;
      const data = call.data;
      const callerUsername = (call.from && call.from.username) || "";
      const isCallerAdmin =
        callerUsername.toLowerCase() === ADMIN_USERNAME.toLowerCase();

      await tgRequest(token, "answerCallbackQuery", {
        callback_query_id: call.id,
      });

      // 1. LIHAT DETAIL SET
      if (data.startsWith("detail_")) {
        const katalogList = await getKatalog();
        const itemId = data.replace("detail_", "");
        const item = katalogList.find((k) => String(k.id) === itemId);

        if (!item) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⚠️ Maaf, set ini sudah dihapus atau diperbarui oleh admin.",
          });
          return res.status(200).json({ ok: true });
        }

        const captionText =
          `✨ <b>${escapeHtml(item.nama)}</b>\n\n` +
          `📦 <b>Isi Paket:</b> ${escapeHtml(item.isi)}\n` +
          `💰 <b>Harga:</b> ${escapeHtml(item.harga)}\n\n` +
          `💳 Klik tombol di bawah untuk memunculkan <b>QRIS + Kode Unik</b>. Setelah transfer & dikonfirmasi, link file otomatis dikirim admin ke chat ini!`;

        const inlineMarkup = {
          inline_keyboard: [
            [
              {
                text: `💳 Beli Set Ini (${item.harga})`,
                callback_data: `buy_${item.id}`,
              },
            ],
          ],
        };

        if (item.photo_id) {
          await tgRequest(token, "sendPhoto", {
            chat_id: chatId,
            photo: item.photo_id,
            caption: captionText,
            parse_mode: "HTML",
            reply_markup: inlineMarkup,
          });
        } else {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: captionText,
            parse_mode: "HTML",
            reply_markup: inlineMarkup,
          });
        }
      }

      // 2. BUAT TAGIHAN QRIS + KODE UNIK
      else if (data.startsWith("buy_")) {
        const qris = await getQris();
        if (!qris || !qris.file_id || !qris.admin_chat_id) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: `⚠️ Pembayaran QRIS sedang disiapkan admin. Silakan chat @${ADMIN_USERNAME} untuk order langsung.`,
          });
          return res.status(200).json({ ok: true });
        }

        let itemNama = "";
        let baseNominal = 2000;
        let targetLink = "";

        if (data === "buy_bundle") {
          const bundle = await getBundle();
          if (!bundle.link) {
            await tgRequest(token, "sendMessage", {
              chat_id: chatId,
              text: `⚠️ Link promo bundling belum diatur. Silakan hubungi @${ADMIN_USERNAME}.`,
            });
            return res.status(200).json({ ok: true });
          }
          itemNama = "Promo Bundling 2 Mini Set";
          baseNominal = 5000;
          targetLink = bundle.link;
        } else {
          const katalogList = await getKatalog();
          const itemId = data.replace("buy_", "");
          const item = katalogList.find((k) => String(k.id) === itemId);
          if (!item) {
            await tgRequest(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Paket tidak ditemukan atau sudah dihapus.",
            });
            return res.status(200).json({ ok: true });
          }
          itemNama = item.nama;
          baseNominal = parseNominal(item.harga);
          targetLink = item.link;
        }

        const order = await createOrder(call.from, itemNama, baseNominal, targetLink);

        const invoiceCaption =
          `🧾 <b>INVOICE PESANAN #${order.id}</b>\n\n` +
          `📦 <b>Paket:</b> ${escapeHtml(order.item_nama)}\n` +
          `💵 <b>Harga Dasar:</b> ${formatRupiah(order.base_nominal)}\n` +
          `🔢 <b>Kode Unik:</b> +${formatRupiah(order.kode_unik)}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `💰 <b>TOTAL TRANSFER: <code>${formatRupiah(order.total_nominal)}</code></b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `⚠️ <b>PENTING:</b> Scan QRIS di atas dan transfer <b>TEPAT sampai 3 digit terakhir</b> (<b>${formatRupiah(order.total_nominal)}</b>) agar admin dapat mengenali pembayaranmu.\n\n` +
          `Setelah transfer berhasil, klik tombol <b>Konfirmasi Pembayaran</b> di bawah 👇`;

        await tgRequest(token, "sendPhoto", {
          chat_id: chatId,
          photo: qris.file_id,
          caption: invoiceCaption,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Konfirmasi Pembayaran",
                  callback_data: `confirm_${order.id}`,
                },
              ],
              [
                {
                  text: "❌ Batalkan Pesanan",
                  callback_data: `cancel_${order.id}`,
                },
              ],
            ],
          },
        });
      }

      // 3. PEMBELI KLIK KONFIRMASI -> KIRIM NOTIF KE ADMIN
      else if (data.startsWith("confirm_")) {
        const orderId = data.replace("confirm_", "");
        const order = await getOrder(orderId);

        if (!order) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⚠️ Pesanan sudah kedaluwarsa. Silakan buat pesanan baru dari katalog.",
          });
          return res.status(200).json({ ok: true });
        }

        if (order.status !== "pending") {
          return res.status(200).json({ ok: true });
        }

        order.status = "waiting_acc";
        await saveOrder(orderId, order);

        await tgRequest(token, "editMessageCaption", {
          chat_id: chatId,
          message_id: messageId,
          caption:
            `⏳ <b>MENUNGGU VERIFIKASI ADMIN (Pesanan #${order.id})</b>\n\n` +
            `📦 Paket: ${escapeHtml(order.item_nama)}\n` +
            `💰 Nominal: <b>${formatRupiah(order.total_nominal)}</b>\n\n` +
            `Konfirmasi kamu sudah masuk ke antrean admin. Link file akan otomatis dikirim ke chat ini segera setelah mutasi terverifikasi!`,
          parse_mode: "HTML",
        });

        const qris = await getQris();
        if (qris && qris.admin_chat_id) {
          const adminNotifText =
            `🔔 <b>PESANAN MASUK #${order.id}</b>\n\n` +
            `👤 <b>Pembeli:</b> ${escapeHtml(order.buyer_name)} (${escapeHtml(order.buyer_username)})\n` +
            `📦 <b>Paket:</b> ${escapeHtml(order.item_nama)}\n` +
            `💰 <b>Nominal Wajib Masuk:</b> <code>${formatRupiah(order.total_nominal)}</code>\n\n` +
            `🔍 <i>Cek mutasi masuk sebesar <b>${formatRupiah(order.total_nominal)}</b> sebelum klik ACC.</i>`;

          await tgRequest(token, "sendMessage", {
            chat_id: qris.admin_chat_id,
            text: adminNotifText,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: `✅ ACC #${order.id} (Kirim Link)`,
                    callback_data: `acc_${order.id}`,
                  },
                  {
                    text: `❌ Tolak #${order.id}`,
                    callback_data: `reject_${order.id}`,
                  },
                ],
              ],
            },
          });
        }
      }

      // 4. PEMBELI BATALKAN PESANAN
      else if (data.startsWith("cancel_")) {
        const orderId = data.replace("cancel_", "");
        const order = await getOrder(orderId);
        if (order && order.status === "pending") {
          order.status = "cancelled";
          await saveOrder(orderId, order);
        }
        await tgRequest(token, "editMessageCaption", {
          chat_id: chatId,
          message_id: messageId,
          caption: `🚫 <b>Pesanan #${orderId} dibatalkan.</b>\nSilakan pilih kembali melalui menu Katalog Mini Set.`,
          parse_mode: "HTML",
        });
      }

      // 5. ADMIN KLIK ACC -> KIRIM LINK KE PEMBELI
      else if (data.startsWith("acc_")) {
        if (!isCallerAdmin) return res.status(200).json({ ok: true });
        const orderId = data.replace("acc_", "");
        const order = await getOrder(orderId);

        if (!order || order.status === "acc") {
          return res.status(200).json({ ok: true });
        }

        order.status = "acc";
        await saveOrder(orderId, order);

        const cleanLink = normalizeUrl(order.target_link);
        await tgRequest(token, "sendMessage", {
          chat_id: order.buyer_id,
          text:
            `🎉 <b>PEMBAYARAN DI-ACC! (Pesanan #${order.id})</b>\n\n` +
            `Terima kasih telah membeli <b>${escapeHtml(order.item_nama)}</b>!\n` +
            `Berikut link akses file kamu:\n` +
            `🔗 ${escapeHtml(cleanLink)}\n\n` +
            `<i>Simpan baik-baik link di atas dan dilarang menyebarluaskan ulang konten.</i>`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📂 Buka Link File Sekarang", url: cleanLink }],
            ],
          },
        });

        await tgRequest(token, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text:
            `✅ <b>PESANAN #${order.id} SUDAH DI-ACC</b>\n` +
            `👤 Pembeli: ${escapeHtml(order.buyer_name)} (${escapeHtml(order.buyer_username)})\n` +
            `📦 Paket: ${escapeHtml(order.item_nama)}\n` +
            `💰 Nominal: <b>${formatRupiah(order.total_nominal)}</b>\n` +
            `📤 <i>Link otomatis telah dikirim ke pembeli.</i>`,
          parse_mode: "HTML",
        });
      }

      // 6. ADMIN KLIK TOLAK (PEMBELI SHADOW / DANA TIDAK MASUK)
      else if (data.startsWith("reject_")) {
        if (!isCallerAdmin) return res.status(200).json({ ok: true });
        const orderId = data.replace("reject_", "");
        const order = await getOrder(orderId);

        if (!order || order.status === "rejected" || order.status === "acc") {
          return res.status(200).json({ ok: true });
        }

        order.status = "rejected";
        await saveOrder(orderId, order);

        await tgRequest(token, "sendMessage", {
          chat_id: order.buyer_id,
          text:
            `❌ <b>PESANAN #${order.id} DITOLAK</b>\n\n` +
            `Pembayaran sebesar <b>${formatRupiah(order.total_nominal)}</b> untuk paket <b>${escapeHtml(order.item_nama)}</b> tidak ditemukan di mutasi kami.\n\n` +
            `Jika kamu sudah transfer sesuai kode unik, silakan kirim bukti transfer ke admin @${ADMIN_USERNAME}.`,
          parse_mode: "HTML",
        });

        await tgRequest(token, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text:
            `❌ <b>PESANAN #${order.id} DITOLAK (DANA TIDAK MASUK)</b>\n` +
            `👤 Pembeli: ${escapeHtml(order.buyer_name)} (${escapeHtml(order.buyer_username)})\n` +
            `💰 Nominal: ${formatRupiah(order.total_nominal)}`,
          parse_mode: "HTML",
        });
      }

      return res.status(200).json({ ok: true });
    }
    // ------------------------------------------
    // B. HANDLER PESAN TEKS & FOTO DARI USER
    // ------------------------------------------
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const senderUsername = (msg.from && msg.from.username) || "";
      const isAdmin =
        senderUsername.toLowerCase() === ADMIN_USERNAME.toLowerCase();

      const rawText = (msg.text || msg.caption || "").trim();
      const lowerText = rawText.toLowerCase();

      // 1. ADMIN: /setqris (PASANG FOTO QRIS & DAFTAR NOTIF ADMIN)
      if (rawText.startsWith("/setqris")) {
        if (!isAdmin) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⛔ Perintah ini hanya bisa digunakan oleh admin.",
          });
          return res.status(200).json({ ok: true });
        }

        if (msg.photo && msg.photo.length > 0) {
          const largestPhoto = msg.photo[msg.photo.length - 1];
          await saveQris({
            file_id: largestPhoto.file_id,
            admin_chat_id: chatId,
          });
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "✅ <b>Foto QRIS & Notifikasi Admin Berhasil Diaktifkan!</b>\n\n" +
              "• Setiap pembeli yang klik beli akan langsung dikirimi foto QRIS ini + kode unik.\n" +
              "• Notifikasi tombol <b>ACC / Tolak</b> akan otomatis masuk ke chat ini.",
            parse_mode: "HTML",
          });
        } else {
          const currentQris = await getQris();
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "💳 <b>PENGATURAN QRIS PEMBAYARAN</b>\n\n" +
              `• Status QRIS: ${currentQris ? "✅ <b>Sudah Terpasang</b>" : "❌ <b>Belum Dipasang</b>"}\n\n` +
              "<b>Cara pasang/ganti QRIS:</b>\n" +
              "Kirim <b>1 foto QRIS</b> kamu ke bot ini dengan caption:\n" +
              "<code>/setqris</code>",
            parse_mode: "HTML",
          });
        }
        return res.status(200).json({ ok: true });
      }

      // 2. ADMIN: /tambah
      if (rawText.startsWith("/tambah")) {
        if (!isAdmin) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⛔ Perintah ini hanya bisa digunakan oleh admin.",
          });
          return res.status(200).json({ ok: true });
        }

        const content = rawText.replace(/^\/tambah\s*/i, "").trim();
        const parts = content.split("|").map((p) => p.trim());

        if (parts.length < 4 || !parts[0] || !parts[1] || !parts[2] || !parts[3]) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "⚠️ <b>Format /tambah kurang lengkap!</b>\n\n" +
              "Kirim <b>1 foto preview</b> dengan caption:\n" +
              "<code>/tambah Nama Set | Isi | Harga | Link File Rahasia</code>\n\n" +
              "<i>Link file hanya akan dikirim bot setelah pembayaran pembeli kamu ACC.</i>",
            parse_mode: "HTML",
          });
          return res.status(200).json({ ok: true });
        }

        let photoId = "";
        if (msg.photo && msg.photo.length > 0) {
          photoId = msg.photo[msg.photo.length - 1].file_id;
        }

        const katalogList = await getKatalog();
        const newItem = {
          id: Date.now().toString(),
          nama: parts[0],
          isi: parts[1],
          harga: parts[2],
          link: normalizeUrl(parts[3]),
          photo_id: photoId,
        };

        katalogList.push(newItem);
        await saveKatalog(katalogList);

        await tgRequest(token, "sendMessage", {
          chat_id: chatId,
          text:
            `✅ <b>Berhasil ditambahkan ke Katalog!</b>\n\n` +
            `• <b>Nama:</b> ${escapeHtml(newItem.nama)}\n` +
            `• <b>Isi:</b> ${escapeHtml(newItem.isi)}\n` +
            `• <b>Harga:</b> ${escapeHtml(newItem.harga)}\n` +
            `• <b>Foto Preview:</b> ${photoId ? "Ada ✅" : "Tidak ada"}\n` +
            `• <b>Link File (Rahasia):</b> ${escapeHtml(newItem.link)}`,
          parse_mode: "HTML",
        });
        return res.status(200).json({ ok: true });
      }

      // 3. ADMIN: /edit
      if (rawText.startsWith("/edit")) {
        if (!isAdmin) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⛔ Perintah ini hanya bisa digunakan oleh admin.",
          });
          return res.status(200).json({ ok: true });
        }

        const katalogList = await getKatalog();
        if (katalogList.length === 0) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "📂 Katalog masih kosong.",
          });
          return res.status(200).json({ ok: true });
        }

        const arg = rawText.replace(/^\/edit\s*/i, "").trim();
        if (!arg) {
          let listText = "✏️ <b>DAFTAR SET UNTUK DI-EDIT</b>\n\n";
          katalogList.forEach((item, idx) => {
            listText += `${idx + 1}. <b>${escapeHtml(item.nama)}</b> (${escapeHtml(item.harga)})\n`;
          });
          listText +=
            "\n<b>Cara Edit:</b>\n" +
            "• Ganti data: <code>/edit [nomor] | Nama | Isi | Harga | Link</code>\n" +
            "• Ganti foto saja: kirim foto baru dengan caption <code>/edit [nomor]</code>";
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: listText,
            parse_mode: "HTML",
          });
          return res.status(200).json({ ok: true });
        }

        const parts = arg.split("|").map((p) => p.trim());
        const idx = parseInt(parts[0], 10) - 1;

        if (isNaN(idx) || idx < 0 || idx >= katalogList.length) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⚠️ Nomor set tidak valid.",
          });
          return res.status(200).json({ ok: true });
        }

        const targetItem = katalogList[idx];
        if (msg.photo && msg.photo.length > 0) {
          targetItem.photo_id = msg.photo[msg.photo.length - 1].file_id;
        }
        if (parts.length >= 5) {
          if (parts[1]) targetItem.nama = parts[1];
          if (parts[2]) targetItem.isi = parts[2];
          if (parts[3]) targetItem.harga = parts[3];
          if (parts[4]) targetItem.link = normalizeUrl(parts[4]);
        }

        katalogList[idx] = targetItem;
        await saveKatalog(katalogList);

        await tgRequest(token, "sendMessage", {
          chat_id: chatId,
          text: `✅ <b>Set #${idx + 1} (${escapeHtml(targetItem.nama)}) berhasil diperbarui!</b>`,
          parse_mode: "HTML",
        });
        return res.status(200).json({ ok: true });
      }

      // 4. ADMIN: /hapus
      if (rawText.startsWith("/hapus")) {
        if (!isAdmin) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⛔ Perintah ini hanya bisa digunakan oleh admin.",
          });
          return res.status(200).json({ ok: true });
        }

        const katalogList = await getKatalog();
        if (katalogList.length === 0) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "📂 Katalog masih kosong.",
          });
          return res.status(200).json({ ok: true });
        }

        const arg = rawText.replace(/^\/hapus\s*/i, "").trim();
        if (!arg) {
          let listText = "🗑️ <b>PILIH NOMOR SET UNTUK DIHAPUS</b>\n\n";
          katalogList.forEach((item, idx) => {
            listText += `${idx + 1}. <b>${escapeHtml(item.nama)}</b> (${escapeHtml(item.harga)})\n`;
          });
          listText += "\nKetik: <code>/hapus [nomor]</code>";
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: listText,
            parse_mode: "HTML",
          });
          return res.status(200).json({ ok: true });
        }

        const idx = parseInt(arg, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= katalogList.length) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⚠️ Nomor set tidak valid.",
          });
          return res.status(200).json({ ok: true });
        }

        const removed = katalogList.splice(idx, 1)[0];
        await saveKatalog(katalogList);

        await tgRequest(token, "sendMessage", {
          chat_id: chatId,
          text: `✅ Set <b>${escapeHtml(removed.nama)}</b> berhasil dihapus.`,
          parse_mode: "HTML",
        });
        return res.status(200).json({ ok: true });
      }

      // 5. ADMIN: /setbundle
      if (rawText.startsWith("/setbundle")) {
        if (!isAdmin) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "⛔ Perintah ini hanya bisa digunakan oleh admin.",
          });
          return res.status(200).json({ ok: true });
        }

        const arg = rawText.replace(/^\/setbundle\s*/i, "").trim();
        const currentBundle = await getBundle();

        if (!arg) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "🎁 <b>PENGATURAN LINK FILE PROMO BUNDLING 5K</b>\n\n" +
              `• <b>Link File Saat Ini:</b> ${
                currentBundle.link ? escapeHtml(currentBundle.link) : "<i>Belum dipasang</i>"
              }\n\n` +
              "<b>Cara pasang:</b>\n<code>/setbundle https://link-file-bundling.com</code>\n" +
              "<b>Cara hapus:</b>\n<code>/setbundle hapuslink</code>",
            parse_mode: "HTML",
          });
          return res.status(200).json({ ok: true });
        }

        if (arg.toLowerCase() === "hapuslink") {
          await saveBundle({ link: "" });
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "✅ Link file promo bundling dihapus.",
          });
          return res.status(200).json({ ok: true });
        }

        const cleanLink = normalizeUrl(arg);
        await saveBundle({ link: cleanLink });
        await tgRequest(token, "sendMessage", {
          chat_id: chatId,
          text: `✅ <b>Link File Promo Bundling 5k disimpan!</b>\n🔗 ${escapeHtml(cleanLink)}`,
          parse_mode: "HTML",
        });
        return res.status(200).json({ ok: true });
      }

      // 6. FOTO TANPA CAPTION PERINTAH
      if (msg.photo) {
        if (isAdmin) {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "💡 Gunakan caption berikut saat mengirim foto:\n" +
              "• Pasang QRIS pembayaran: <code>/setqris</code>\n" +
              "• Tambah set baru: <code>/tambah Nama Set | Isi | Harga | Link File</code>\n" +
              "• Ganti foto set lama: <code>/edit [nomor]</code>",
            parse_mode: "HTML",
            reply_to_message_id: msg.message_id,
          });
        } else {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "Pembayaran dilakukan melalui QRIS + Kode Unik di menu Katalog.\n" +
              `Jika butuh bantuan langsung, silakan hubungi admin @${ADMIN_USERNAME} 🙏`,
            reply_to_message_id: msg.message_id,
          });
        }
        return res.status(200).json({ ok: true });
      }

      // 7. MENU UTAMA & AUTO-REPLY PEMBELI
      if (msg.text) {
        const text = msg.text.trim();

        if (text === "/start") {
          let welcomeText =
            "✨ <b>Selamat datang di Bot Lumine Photopack | Mini Set!</b> ✨\n\n" +
            "Di sini kamu bisa cek katalog paket hemat & eceran (kualitas tetap HD, tanpa watermark).\n\n" +
            "💰 <b>Daftar Harga:</b>\n" +
            "• Paket Lite (5–7 Foto) : <b>Rp 2.000</b>\n" +
            "• Paket Standar (8–10 Foto) : <b>Rp 3.000</b>\n" +
            "• 🎁 <b>Promo Bundling 2 Mini Set : Rp 5.000</b>\n\n" +
            "⚡ <b>Cara Order Praktis:</b>\n" +
            "Pilih set di katalog, scan QRIS sesuai nominal kode unik, klik Konfirmasi, dan link file otomatis masuk ke chat ini setelah dicek admin!\n\n" +
            "Silakan pilih menu di bawah ini 👇";

          if (isAdmin) {
            welcomeText +=
              "\n\n🛠️ <b>Mode Admin Aktif:</b>\n" +
              "• Kirim foto QRIS + caption <code>/setqris</code>\n" +
              "• <code>/tambah Nama | Isi | Harga | Link File</code>\n" +
              "• <code>/edit</code> | <code>/hapus</code> | <code>/setbundle</code>";
          }

          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: getMainMenu(),
          });
        } else if (text === "🛍️ Katalog Mini Set") {
          const katalogList = await getKatalog();
          if (katalogList.length === 0) {
            await tgRequest(token, "sendMessage", {
              chat_id: chatId,
              text: `📂 Katalog Mini Set sedang diperbarui. Hubungi @${ADMIN_USERNAME} untuk info stok terbaru.`,
            });
          } else {
            await tgRequest(token, "sendMessage", {
              chat_id: chatId,
              text:
                "📂 <b>KATALOG LUMINE MINI SET</b>\n" +
                "Pilih set di bawah untuk melihat foto preview & melakukan pembayaran QRIS:",
              parse_mode: "HTML",
              reply_markup: buildKatalogKeyboard(katalogList),
            });
          }
        } else if (text === "🎁 Promo Bundling 5k") {
          await sendPromoBundling(token, chatId);
        } else if (text === "📋 Cara Beli & Aturan") {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "📋 <b>PANDUAN & ATURAN PEMBELIAN</b>\n\n" +
              "1️⃣ <b>Pilih Paket di Katalog</b>\n" +
              "Buka <b>🛍️ Katalog Mini Set</b>, cek preview, lalu klik tombol <b>Beli Set Ini</b>.\n\n" +
              "2️⃣ <b>Scan QRIS + Kode Unik</b>\n" +
              "Bot akan menampilkan foto QRIS beserta nominal dengan <b>3 digit kode unik</b>. Wajib transfer sesuai nominal persis agar pesanan terdeteksi.\n\n" +
              "3️⃣ <b>Konfirmasi & Terima File</b>\n" +
              "Klik <b>✅ Konfirmasi Pembayaran</b>. Setelah admin ACC, bot otomatis mengirimkan link file ke chat ini.\n\n" +
              `• Ada kendala? Hubungi admin: @${ADMIN_USERNAME}`,
            parse_mode: "HTML",
          });
        } else if (text === "💎 Upgrade CH Utama") {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text:
              "💎 <b>UPGRADE KE FULL SET (CHANNEL UTAMA)</b>\n\n" +
              "✅ Full Set lengkap (isi <b>20 – 40+ foto HD</b>)\n" +
              "✅ <b>Bonus Video</b> eksklusif\n" +
              "✅ Harga: <b>Rp 5.000 – Rp 10.000</b>\n\n" +
              "Klik tombol di bawah untuk chat admin 👇",
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "💬 Chat Admin untuk Join CH Utama",
                    url: `https://t.me/${ADMIN_USERNAME}`,
                  },
                ],
              ],
            },
          });
        } else if (text === "🔗 Channel Lainnya") {
          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: "🔗 <b>TAUTAN CHANNEL RESMI LUMINE</b>",
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🛡️ Channel Cadangan", url: LINK_CH_CADANGAN }],
                [{ text: "🎁 Channel Asupan Free", url: LINK_CH_FREE }],
                [{ text: `👤 Admin (@${ADMIN_USERNAME})`, url: `https://t.me/${ADMIN_USERNAME}` }],
              ],
            },
          });
        } else {
          if (["bundling", "bundle", "promo", "diskon", "2 set"].some((k) => lowerText.includes(k))) {
            await sendPromoBundling(token, chatId, msg.message_id);
            return res.status(200).json({ ok: true });
          }

          let replyText =
            "Halo! Gunakan tombol menu di bawah untuk melihat katalog, promo bundling 5k, dan aturan pembelian.\n" +
            `Butuh bantuan? Hubungi @${ADMIN_USERNAME} 🙏`;

          if (["harga", "berapa", "brp", "list", "daftar"].some((k) => lowerText.includes(k))) {
            replyText =
              "💰 <b>Info Harga Lumine Mini Set:</b>\n" +
              "• Paket Lite (5–7 Foto HD) : <b>Rp 2.000</b>\n" +
              "• Paket Standar (8–10 Foto HD) : <b>Rp 3.000</b>\n" +
              "• 🎁 <b>Promo Bundling 2 Mini Set : Rp 5.000</b>\n\n" +
              "Klik menu <b>🛍️ Katalog Mini Set</b> untuk pilih paket & bayar via QRIS!";
          } else if (["cara", "beli", "order", "bayar", "qris", "scan"].some((k) => lowerText.includes(k))) {
            replyText =
              "⚡ <b>Cara Order QRIS:</b>\n" +
              "1. Pilih paket di <b>🛍️ Katalog Mini Set</b>.\n" +
              "2. Klik <b>Beli Set Ini</b> untuk memunculkan QRIS + kode unik.\n" +
              "3. Transfer sesuai nominal unik lalu klik <b>Konfirmasi Pembayaran</b>.";
          }

          await tgRequest(token, "sendMessage", {
            chat_id: chatId,
            text: replyText,
            parse_mode: "HTML",
            reply_to_message_id: msg.message_id,
          });
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook Error:", err);
    return res.status(200).json({ ok: true });
  }
};
