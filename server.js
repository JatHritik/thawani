import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ================================
// 🔹 CONFIG
// ================================
const publicKey = "kBfrrJquZn3rzt6HoKyq57Y5a1Pwdm";
const secretKey = "6kwqK01g3axYURDZ0a2BEznuK9hQ47";

let Zoho_Access_Token = "";
const Zoho_Refresh_Token =
  "1000.9493cb6318abbf6d5ca40c3b62fbcb7b.13b0951362271e73d2183e5fa82130f6";

const client_id = "1000.G50URJBM3EWK776ZKU5JAY3BMML3BF";
const client_secret = "8eb4a714d3f1eca4c0b165915a998615edc5456a58";
const organization_id = "854546555";

const PORT = 3000;

// ================================
// 🔹 REFRESH ZOHO TOKEN
// ================================
async function refreshZohoToken() {
  const res = await axios.post(
    "https://accounts.zoho.com/oauth/v2/token",
    null,
    {
      params: {
        refresh_token: Zoho_Refresh_Token,
        client_id,
        client_secret,
        grant_type: "refresh_token",
      },
    }
  );

  Zoho_Access_Token = res.data.access_token;
}

// ================================
// 🔹 FETCH SINGLE INVOICE
// ================================
async function fetchInvoiceById(invoice_id) {
  const res = await axios.get(
    `https://www.zohoapis.com/books/v3/invoices/${invoice_id}`,
    {
      params: { organization_id },
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
      },
    }
  );

  return res.data.invoice;
}

// ================================
// 🔹 CREATE PAYMENT IN ZOHO (ONLY WHEN PAID)
// ================================
async function createZohoCustomerPayment(invoice, thawaniSession) {
  const payload = {
    customer_id: invoice.customer_id,
    payment_mode: "Thawani",
    amount: invoice.total,
    date: new Date().toISOString().split("T")[0],
    reference_number: `THW-${invoice.invoice_number}`,
    description: `Thawani Session: ${thawaniSession.session_id}`,
    account_name: "Bank Muscat 03710247642710019",
    invoices: [
      {
        invoice_id: invoice.invoice_id,
        amount_applied: invoice.total,
      },
    ],
  };

  await axios.post(
    `https://www.zohoapis.com/books/v3/customerpayments?organization_id=${organization_id}`,
    payload,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
      },
    }
  );

  // mark invoice as synced
  await axios.put(
    `https://www.zohoapis.com/books/v3/invoices/${invoice.invoice_id}?organization_id=${organization_id}`,
    {
      custom_fields: [
        { api_name: "cf_payment_synced", value: true },
      ],
    },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
      },
    }
  );

  console.log(`✅ Payment created for invoice ${invoice.invoice_number}`);
}

// ================================
// 🔹 CREATE THAWANI SESSION (BUTTON)
// ================================
async function createThawaniSession(invoice) {
  const res = await axios.post(
    "https://checkout.thawani.om/api/v1/checkout/session",
    {
      client_reference_id: invoice.customer_name,
      mode: "payment",
      products: [
        {
          name: `Invoice ${invoice.invoice_number}`,
          quantity: 1,
          unit_amount: Math.round(invoice.total * 1000),
        },
      ],
      success_url: "https://thw.om/success",
      cancel_url: "https://thw.om/cancel",
      metadata: {
        invoice_id: invoice.invoice_id,
      },
    },
    {
      headers: {
        "thawani-api-key": secretKey,
      },
    }
  );

  const session = res.data.data;
  const paymentLink = `https://checkout.thawani.om/pay/${session.session_id}?key=${publicKey}`;

  // save payment link
  await axios.put(
    `https://www.zohoapis.com/books/v3/invoices/${invoice.invoice_id}?organization_id=${organization_id}`,
    {
      custom_fields: [
        { api_name: "cf_payment_link", value: paymentLink },
      ],
    },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
      },
    }
  );

  return paymentLink;
}

// ================================
// 🔹 AUTO VERIFY PAYMENTS (EVERY 1 MIN)
// ================================
async function autoVerifyPayments() {
  await refreshZohoToken();

  const res = await axios.get(
    "https://www.zohoapis.com/books/v3/invoices",
    {
      params: { status: "unpaid", organization_id },
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
      },
    }
  );

  const invoices = res.data.invoices || [];

  for (const invoice of invoices) {
    const synced = invoice.custom_fields?.find(
      f => f.api_name === "cf_payment_synced"
    );

    if (synced?.value === true) continue;

    const linkField = invoice.custom_fields?.find(
      f => f.api_name === "cf_payment_link"
    );

    if (!linkField?.value) continue;

    const match = linkField.value.match(/pay\/(checkout_[^?]+)/);
    if (!match) continue;

    const session_id = match[1];

    const verify = await axios.get(
      `https://checkout.thawani.om/api/v1/checkout/session/${session_id}`,
      {
        headers: { "thawani-api-key": secretKey },
      }
    );

    if (verify.data.data.payment_status === "paid") {
      await createZohoCustomerPayment(invoice, verify.data.data);
    }
  }
}

// ================================
// 🔹 ROUTE (ZOHO BUTTON)
// ================================
app.get("/generate-payment-link", async (req, res) => {
  try {
    const { invoice_id } = req.query;
    if (!invoice_id) return res.status(400).json({ error: "invoice_id required" });

    await refreshZohoToken();
    const invoice = await fetchInvoiceById(invoice_id);
    const link = await createThawaniSession(invoice);

    res.json({
      success: true,
      invoice_id,
      payment_link: link,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================
// 🔹 START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`⏱️ Auto payment verification running every 1 minute`);
});

// ⏱️ RUN EVERY 1 MINUTE
setInterval(autoVerifyPayments, 60 * 1000);
