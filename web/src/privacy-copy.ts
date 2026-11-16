import type { Language } from "@fairshare/domain";

export const PRIVACY_EMAIL = "sotirios.k.goulas@gmail.com";
export const PRIVACY_DPA_URL = "https://www.dpa.gr";

export type PrivacySection = { heading: string; paragraphs: string[] };

export type PrivacyCopy = {
  title: string;
  back: string;
  sections: PrivacySection[];
  complaintLead: string;
  updated: string;
};

const en: PrivacyCopy = {
  title: "Privacy",
  back: "Back to home",
  sections: [
    {
      heading: "Who runs this",
      paragraphs: [
        "Fair Share is run by me, Sotirios Goulas, a private individual in Greece. I am the controller of the data described here. For any privacy request, write to " +
          PRIVACY_EMAIL +
          ".",
      ],
    },
    {
      heading: "What a trip stores",
      paragraphs: [
        "A trip stores its name, the people you add (whatever names you type), and each expense: what it was, who paid, the amount and who shared it. There are no accounts, email addresses or phone numbers.",
        "If you add photos, a trip also stores a resized copy of each photo and a full-size original. Your browser re-encodes the resized copy. A JPEG original is uploaded unchanged, so it can carry what the camera wrote into it, such as the time and the GPS location (EXIF).",
        "Each trip gets a random 6-digit PIN for its photos. I store only a hash of it, not the PIN.",
        "Names you type may belong to other people. Add only what your group is fine with.",
      ],
    },
    {
      heading: "Who can see a trip",
      paragraphs: [
        "A trip has no password. Anyone with its link can read and edit the expenses, so share the link only with the people on the trip. The PIN is a second lock on the photos only. I do not browse trips and I use them for nothing else.",
      ],
    },
    {
      heading: "Why I use this data",
      paragraphs: [
        "I store trip data to give you the service you asked for when you created the trip (GDPR Art. 6(1)(b)). I use IP addresses for spam and abuse protection, which is my legitimate interest (Art. 6(1)(f)). I do not rely on consent, so there is none to withdraw.",
      ],
    },
    {
      heading: "IP addresses and rate limits",
      paragraphs: [
        "To stop abuse, the server counts requests per IP address (for IPv6, per /64 range) for creating trips, uploading photos and trying PINs. A counter holds the address and a number, and only for its time window: 10 minutes for photo uploads, 15 minutes and 1 hour for PIN attempts, 1 hour and 1 day for trip creation. A daily cleanup removes any that are left, so none lives much longer than a day after its window ends.",
        "Cloudflare, which hosts the site, also sees IP addresses in its own server logs and keeps them under its own retention rules, not mine.",
      ],
    },
    {
      heading: "Who else handles the data",
      paragraphs: [
        "Cloudflare is my only processor: it hosts the app, the database, the photo storage and the network in front of them. The copy at pithelo.com/fairshare is served through pithelo.com, which is also on Cloudflare. I add no analytics, advertising or tracking tools, and I do not sell or share the data.",
      ],
    },
    {
      heading: "What stays in your browser",
      paragraphs: [
        "Fair Share sets no cookies. It uses your browser's storage: your recent trips (link ID and name, up to 8), your language and theme, and a short error log (the last 20 messages) that never leaves your device. These stay until you clear site data. The PIN and photo access token of a trip are kept only while the tab is open. A service worker also caches the app and the trips and photos you opened, so they work offline.",
      ],
    },
    {
      heading: "How long I keep it",
      paragraphs: [
        "A trip and all its photos are deleted 12 months after the trip last changed: an expense or person edited, a PIN set, or a photo added or removed. Opening a trip does not count as a change. A daily job does the deletion. You can delete a trip sooner with Delete in the trip's More menu, or ask me by email. After a deletion, the trip may remain for up to 30 days in the database's point-in-time backups before it disappears.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "You can ask me for access to your data, for correction or deletion, or object to how I use it. Trips have no owner account, so include the trip link so I can find it.",
      ],
    },
  ],
  complaintLead: "You can also complain to the Hellenic Data Protection Authority: ",
  updated: "Last updated: 16 November 2026",
};

const el: PrivacyCopy = {
  title: "Απόρρητο",
  back: "Πίσω στην αρχική",
  sections: [
    {
      heading: "Ποιος διαχειρίζεται την υπηρεσία",
      paragraphs: [
        "Το Fair Share το διαχειρίζομαι εγώ, ο Σωτήριος Γκούλας, φυσικό πρόσωπο στην Ελλάδα. Είμαι ο υπεύθυνος επεξεργασίας των δεδομένων που περιγράφονται εδώ. Για κάθε αίτημα σχετικά με το απόρρητο, γράψε στο " +
          PRIVACY_EMAIL +
          ".",
      ],
    },
    {
      heading: "Τι αποθηκεύει ένα ταξίδι",
      paragraphs: [
        "Ένα ταξίδι αποθηκεύει το όνομά του, τα άτομα που προσθέτεις (όποια ονόματα πληκτρολογήσεις) και κάθε έξοδο: τι ήταν, ποιος πλήρωσε, το ποσό και ποιοι το μοιράστηκαν. Δεν υπάρχουν λογαριασμοί, διευθύνσεις email ή τηλέφωνα.",
        "Αν προσθέσεις φωτογραφίες, το ταξίδι αποθηκεύει επίσης ένα μικρότερο αντίγραφο κάθε φωτογραφίας και το πρωτότυπο σε πλήρες μέγεθος. Το μικρότερο αντίγραφο το επανακωδικοποιεί ο browser σου. Ένα πρωτότυπο JPEG ανεβαίνει αμετάβλητο, οπότε μπορεί να περιέχει όσα έγραψε η κάμερα μέσα του, όπως την ώρα και την τοποθεσία GPS (EXIF).",
        "Κάθε ταξίδι παίρνει ένα τυχαίο 6ψήφιο PIN για τις φωτογραφίες του. Αποθηκεύω μόνο ένα hash του, όχι το ίδιο το PIN.",
        "Τα ονόματα που πληκτρολογείς μπορεί να ανήκουν σε άλλους ανθρώπους. Πρόσθεσε μόνο ό,τι αποδέχεται η παρέα σου.",
      ],
    },
    {
      heading: "Ποιος βλέπει ένα ταξίδι",
      paragraphs: [
        "Ένα ταξίδι δεν έχει κωδικό. Όποιος έχει τον σύνδεσμό του μπορεί να διαβάσει και να επεξεργαστεί τα έξοδα, γι' αυτό μοιράσου τον μόνο με τα άτομα του ταξιδιού. Το PIN είναι δεύτερη κλειδαριά μόνο για τις φωτογραφίες. Δεν περιηγούμαι στα ταξίδια και δεν τα χρησιμοποιώ για τίποτε άλλο.",
      ],
    },
    {
      heading: "Γιατί χρησιμοποιώ αυτά τα δεδομένα",
      paragraphs: [
        "Αποθηκεύω τα δεδομένα του ταξιδιού για να σου παρέχω την υπηρεσία που ζήτησες όταν το δημιούργησες (άρθρο 6 παρ. 1 β΄ ΓΚΠΔ). Χρησιμοποιώ τις διευθύνσεις IP για προστασία από spam και κατάχρηση, που είναι έννομο συμφέρον μου (άρθρο 6 παρ. 1 στ΄). Δεν βασίζομαι σε συγκατάθεση, άρα δεν υπάρχει κάτι να ανακληθεί.",
      ],
    },
    {
      heading: "Διευθύνσεις IP και όρια χρήσης",
      paragraphs: [
        "Για να αποτρέπω την κατάχρηση, ο διακομιστής μετράει αιτήματα ανά διεύθυνση IP (για IPv6, ανά περιοχή /64) για δημιουργία ταξιδιών, ανέβασμα φωτογραφιών και δοκιμές PIN. Ο μετρητής κρατά τη διεύθυνση και έναν αριθμό, μόνο για το χρονικό του παράθυρο: 10 λεπτά για ανέβασμα φωτογραφιών, 15 λεπτά και 1 ώρα για δοκιμές PIN, 1 ώρα και 1 ημέρα για δημιουργία ταξιδιών. Μια ημερήσια εκκαθάριση αφαιρεί όσους απομένουν, άρα κανένας δεν ζει πολύ περισσότερο από μία ημέρα μετά το τέλος του παραθύρου του.",
        "Η Cloudflare, που φιλοξενεί τον ιστότοπο, βλέπει επίσης διευθύνσεις IP στα δικά της αρχεία καταγραφής και τις διατηρεί σύμφωνα με τους δικούς της κανόνες διατήρησης, όχι τους δικούς μου.",
      ],
    },
    {
      heading: "Ποιος άλλος χειρίζεται τα δεδομένα",
      paragraphs: [
        "Η Cloudflare είναι ο μοναδικός εκτελών την επεξεργασία: φιλοξενεί την εφαρμογή, τη βάση δεδομένων, την αποθήκευση φωτογραφιών και το δίκτυο μπροστά από αυτά. Το αντίγραφο στο pithelo.com/fairshare εξυπηρετείται μέσω του pithelo.com, που επίσης βρίσκεται στην Cloudflare. Δεν προσθέτω εργαλεία analytics, διαφήμισης ή παρακολούθησης και δεν πουλάω ούτε μοιράζομαι τα δεδομένα.",
      ],
    },
    {
      heading: "Τι μένει στον browser σου",
      paragraphs: [
        "Το Fair Share δεν ορίζει cookies. Χρησιμοποιεί την αποθήκευση του browser σου: τα πρόσφατα ταξίδια (ID συνδέσμου και όνομα, έως 8), τη γλώσσα και το θέμα, και ένα σύντομο αρχείο σφαλμάτων (τα τελευταία 20 μηνύματα) που δεν φεύγει ποτέ από τη συσκευή σου. Αυτά μένουν μέχρι να διαγράψεις τα δεδομένα του ιστότοπου. Το PIN και το διακριτικό πρόσβασης στις φωτογραφίες ενός ταξιδιού κρατιούνται μόνο όσο είναι ανοιχτή η καρτέλα. Ένας service worker αποθηκεύει επίσης προσωρινά την εφαρμογή και τα ταξίδια και τις φωτογραφίες που άνοιξες, ώστε να λειτουργούν χωρίς σύνδεση.",
      ],
    },
    {
      heading: "Πόσο καιρό τα κρατώ",
      paragraphs: [
        "Ένα ταξίδι και όλες οι φωτογραφίες του διαγράφονται 12 μήνες μετά την τελευταία αλλαγή του: επεξεργασία εξόδου ή ατόμου, ορισμός PIN, ή προσθήκη ή διαγραφή φωτογραφίας. Το άνοιγμα ενός ταξιδιού δεν μετράει ως αλλαγή. Τη διαγραφή την κάνει καθημερινή διαδικασία. Μπορείς να διαγράψεις ένα ταξίδι νωρίτερα με το Διαγραφή στο μενού Περισσότερα του ταξιδιού, ή να μου το ζητήσεις με email. Μετά τη διαγραφή, το ταξίδι μπορεί να παραμείνει έως και 30 ημέρες στα αντίγραφα ασφαλείας της βάσης δεδομένων (point-in-time) πριν εξαφανιστεί.",
      ],
    },
    {
      heading: "Τα δικαιώματά σου",
      paragraphs: [
        "Μπορείς να μου ζητήσεις πρόσβαση στα δεδομένα σου, διόρθωση ή διαγραφή, ή να αντιταχθείς στη χρήση τους. Τα ταξίδια δεν έχουν λογαριασμό ιδιοκτήτη, οπότε συμπερίλαβε τον σύνδεσμο του ταξιδιού για να το βρω.",
      ],
    },
  ],
  complaintLead: "Μπορείς επίσης να υποβάλεις καταγγελία στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα: ",
  updated: "Τελευταία ενημέρωση: 16 Νοεμβρίου 2026",
};

export const PRIVACY_COPY: Record<Language, PrivacyCopy> = { en, el };
