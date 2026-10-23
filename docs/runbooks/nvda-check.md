# Runbook: the NVDA screen-reader check of the website on staging (M2.5, owner)

**Why:** people who can't see the screen use a screen reader, which reads the page aloud and is driven by the keyboard. Our automated checks (axe, Lighthouse, the keyboard tests) pass on every page, but only a person listening can tell whether the site *sounds* right. NVDA is the free screen reader most Windows users have. This check is the last step before you approve M2.5.

**Time:** about 30–40 minutes. **Needs:** your PC, headphones or speakers, and the staging site (you sign in through Cloudflare Access as usual).

**Never:** submit a form with real client details. Use your own name and a test message ("NVDA test, please ignore"). A test lead and its emails are expected and harmless on staging.

---

## Part 1: install NVDA (5 minutes, once)

1. Open **https://www.nvaccess.org/download/** in your browser.
2. NV Access asks for an optional donation: choose **Skip donation this time**, then **Download**.
3. Open the downloaded file (`nvda_….exe`). Windows may ask "Do you want to allow this app to make changes?": click **Yes**.
4. Tick **I agree** to the licence and click **Install NVDA on this computer**, then **Continue**. Leave the options as they are and click **Install**.
5. When it finishes, NVDA starts talking. A "Welcome to NVDA" window appears: click **OK**.
6. If it asks about usage statistics, choose **No**.

**To stop NVDA at any time:** press **Insert + Q**, then **Enter** (Yes). **To start it again:** press **Ctrl + Alt + N**.

**To make it talk slower:** press **Insert + Ctrl + Down arrow** a few times (Up arrow for faster).

## Part 2: the keys you need

On most keyboards "the NVDA key" is **Insert**.

| Key | What it does |
|---|---|
| **Tab** / **Shift + Tab** | Next / previous link, button or form field |
| **H** / **Shift + H** | Next / previous heading |
| **D** | Next landmark (the header, main content, footer) |
| **Down arrow** | Read the next line |
| **Enter** / **Space** | Follow a link, press a button, open or close an FAQ answer |
| **Ctrl** | Stop talking |
| **Insert + F7** | A list of every heading or link on the page (Escape to close) |
| **Insert + Space** | Switch between reading mode and typing mode (NVDA usually switches by itself in forms; you hear a low or high "click") |

## Part 3: the pages and what to listen for

Use Chrome or Edge, signed in to staging. For each page: open it, press **Ctrl** to stop the automatic reading, then work through the list. Write down anything that sounds wrong or confusing (see Part 4). Staging: **https://techaust-platform-web-staging.techaust-technologies-153.workers.dev**

### 1. Home page (`/`)
- The first **Tab** should say "Skip to main content, link". Press **Enter**: the next **Tab** should land inside the page's main content, not back in the menu.
- Press **H** repeatedly: you should hear one "heading level 1" (the page's main title) and then sensible section headings in order.
- Press **D** a few times: you should hear "banner" (header), "main" and "content info" (footer).

### 2. A service page (`/services/app-rescue`)
- **Tab** to the menu: on "Services" you should hear "Services, button, collapsed, **current**".
- Press **Enter** on it: "expanded". **Tab** into the panel: on "App Rescue" you should hear "**current page**". Press **Escape**: the panel closes and you are back on the Services button.
- Find the FAQ (press **H** until you hear "FAQs, heading level 2"). **Tab** to a question and press **Enter**: you should hear "expanded", then **Down arrow** reads the answer. **Enter** again: "collapsed".
- The price near the top should be read as a sentence that makes sense (for example "from ₹…, plus GST"), not as loose numbers.

### 3. Pricing (`/pricing`)
- On "Pricing" in the menu you should hear "current page".
- Find the currency choice in the header (**Tab** until you hear "Show prices in, grouping", then "INR, radio button, checked"). Press the **Right arrow**: you should hear "USD, radio button, checked", and the prices on the page should now be read in dollars.
- The note near the prices has a button "Show in USD" (or "Show in INR"): **Enter** on it should switch the currency the same way.

### 4. Contact form (`/contact`)
- **Tab** through the form. Every field should say its label ("Name, edit", "Email, edit", "Message, edit") and whether it is required.
- Press **Tab** to the **Send message** button without filling anything and press **Enter**: you should hear the errors (an error summary or each field's error), and focus should move to them, not stay silent.
- Fill it in with your test details and send it. The "I'm human" check runs by itself on staging. You should land on a "Thanks" page whose heading is read out.
- External links (LinkedIn, WhatsApp) should say "**opens in a new tab**".

### 5. Get a quote (`/get-a-quote`)
- Each step's heading should be read in full when you reach it.
- The choice tiles (service, budget, timeline) are radio buttons: you should hear the group's question, then each choice as "…, radio button", and the **arrow keys** move between them.
- Trigger an error (press **Send request** with a required choice empty): the error summary should be read in full, and focus should move to it.
- Don't send this one: one test lead from the contact form is enough.

### 6. About (`/about`) and one legal page (`/privacy`)
- Press **H** through the headings: they should follow the page in a sensible order (no jumps from level 1 to level 4).
- On About, the founder's LinkedIn link should say "opens in a new tab".

### 7. Phone width (optional, 5 minutes)
- Make the browser window narrow (about a third of the screen). On any page, **Tab** to the menu button: it should say "Menu, button, collapsed"; **Enter** opens it, and on the current page's link you should hear "current page".

## Part 4: what to send me

For each problem, one line: **the page, what you pressed, what you heard, what you expected.** For example:
> Pricing: Tab to the currency switch; it said "button" only; I expected it to say INR or USD.

If everything sounded right, just say "NVDA: all fine". I fix anything you find in a follow-up PR in this task, then you approve M2.5 with "approved".

You can keep NVDA installed (it only runs when you start it) or remove it: **Settings → Apps → Installed apps → NVDA → Uninstall**.
