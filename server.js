import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ================================
// CONFIG
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
// REFRESH ZOHO TOKEN
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
// FETCH INVOICE
// ================================
async function fetchInvoice(invoice_id) {
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
// CREATE THAWANI SESSION (NEW LINK)
// ================================
async function createThawaniSession(invoice) {
  const res = await axios.post(
    "https://checkout.thawani.om/api/v1/checkout/session",
    {
      client_reference_id: invoice.invoice_number,
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
    },
    {
      headers: {
        "thawani-api-key": secretKey,
      },
    }
  );

  const session = res.data.data;
  const paymentLink = `https://checkout.thawani.om/pay/${session.session_id}?key=${publicKey}`;

  // SAVE / OVERWRITE LINK IN BOOKS
  await axios.put(
    `https://www.zohoapis.com/books/v3/invoices/${invoice.invoice_id}?organization_id=${organization_id}`,
    {
      custom_fields: [
        {
          api_name: "cf_payment_link",
          value: paymentLink,
        },
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
// AUTO VERIFY PAYMENTS
// ================================
async function autoVerifyPayments() {
  try {
    await refreshZohoToken();

    const res = await axios.get(
      "https://www.zohoapis.com/books/v3/invoices",
      {
        params: {
          status: "unpaid",
          organization_id,
        },
        headers: {
          Authorization: `Zoho-oauthtoken ${Zoho_Access_Token}`,
        },
      }
    );

    const invoices = res.data.invoices || [];

    for (const invoice of invoices) {
      const linkField = invoice.custom_fields?.find(
        (f) => f.api_name === "cf_payment_link"
      );

      if (!linkField?.value) continue;

      const match = linkField.value.match(/pay\/(checkout_[^?]+)/);
      if (!match) continue;

      const session_id = match[1];

      const verify = await axios.get(
        `https://checkout.thawani.om/api/v1/checkout/session/${session_id}`,
        {
          headers: {
            "thawani-api-key": secretKey,
          },
        }
      );

      if (verify.data.data.payment_status === "paid") {
        console.log(
          `✅ Payment received for Invoice: ${invoice.invoice_number}`
        );
        // 🔮 Future: Zoho payment create logic yahin ayega
      }
    }
  } catch (err) {
    console.error("Auto verify error:", err.message);
  }
}

// ================================
// ROUTE (ZOHO BUTTON)
// ================================
app.get("/generate-payment-link", async (req, res) => {
  try {
    const { invoice_id } = req.query;
    if (!invoice_id) {
      return res.status(400).json({ error: "invoice_id required" });
    }

    await refreshZohoToken();
    const invoice = await fetchInvoice(invoice_id);
    const paymentLink = await createThawaniSession(invoice);

    res.json({
      success: true,
      invoice_id,
      payment_link: paymentLink,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================
// START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// ⏱️ AUTO VERIFY EVERY 1 MINUTE
setInterval(autoVerifyPayments, 60 * 1000);
