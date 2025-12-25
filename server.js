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
  console.log("✅ Zoho Access Token generated");
}

// ================================
// 🔹 FETCH UNPAID INVOICES
// ================================
async function fetchUnpaidInvoices() {
  const res = await axios.get(
    "https://www.zohoapis.com/books/v3/invoices",
    {
      params: { status: "unpaid" },
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
        "X-com-zoho-books-organizationid": organization_id,
      },
    }
  );

  return res.data.invoices || [];
}

// ================================
// 🔹 UPDATE INVOICE WITH PAYMENT LINK
// ================================
async function updateInvoiceWithPaymentLink(invoice_id, paymentLink) {
  await axios.put(
    `https://www.zohoapis.com/books/v3/invoices/${invoice_id}?organization_id=${organization_id}`,
    {
      custom_fields: [
        { api_name: "cf_payment_link", value: paymentLink },
      ],
    },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("🔗 Invoice updated with payment link");
}

// ================================
// 🔹 CREATE CUSTOMER PAYMENT (ZOHO)
// ================================
async function createZohoCustomerPayment(invoice, thawaniSession) {
  const payload = {
    customer_id: invoice.customer_id,
    payment_mode: "Thawani",
    amount: invoice.total,
    date: new Date().toISOString().split("T")[0],

    // ✅ < 50 chars
    reference_number: `THW-${invoice.invoice_number}`,

    description: `Thawani Session ID: ${thawaniSession.session_id}`,
    account_name: "Bank Muscat 03710247642710019",
    invoices: [
      {
        invoice_id: invoice.invoice_id,
        amount_applied: invoice.total,
      },
    ],
  };

  console.log("\n📤 ZOHO PAYMENT PAYLOAD:");
  console.log(JSON.stringify(payload, null, 2));

  const res = await axios.post(
    `https://www.zohoapis.com/books/v3/customerpayments?organization_id=${organization_id}`,
    payload,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("✅ Zoho Payment Created:", res.data);
}

// ================================
// 🔹 CREATE THAWANI SESSION
// ================================
async function createThawaniPaymentSession(invoice) {
  const res = await axios.post(
    "https://checkout.thawani.om/api/v1/checkout/session",
    {
      client_reference_id: invoice.customer_name,
      mode: "payment",
      products: [
        {
          name: `Invoice ${invoice.invoice_number}`,
          quantity: 1,
          unit_amount: Math.min(
            Math.round(invoice.total * 1000),
            5000000
          ),
        },
      ],
      success_url: "https://thw.om/success",
      cancel_url: "https://thw.om/cancel",
      metadata: {
        invoice_id: invoice.invoice_id,
        customer_name: invoice.customer_name,
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "thawani-api-key": secretKey,
      },
    }
  );

  const thawaniData = res.data.data;
  const paymentLink = `https://checkout.thawani.om/pay/${thawaniData.session_id}?key=${publicKey}`;

  console.log("\n================ THAWANI SESSION RESPONSE ================");
  console.log(JSON.stringify(res.data, null, 2));
  console.log("💳 PAYMENT LINK:", paymentLink);
  console.log("=========================================================");

  await createZohoCustomerPayment(invoice, thawaniData);
  await updateInvoiceWithPaymentLink(invoice.invoice_id, paymentLink);
}

// ================================
// 🔹 ROUTE (HIT THIS)
// ================================
app.get("/run-thawani-sync", async (req, res) => {
  try {
    await refreshZohoToken();
    const invoices = await fetchUnpaidInvoices();

    for (const invoice of invoices) {
      await createThawaniPaymentSession(invoice);
    }

    res.json({
      success: true,
      message: "Thawani + Zoho sync completed",
      invoices_processed: invoices.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================
// 🔹 START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`👉 HIT: http://localhost:${PORT}/run-thawani-sync`);
});
