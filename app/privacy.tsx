// app/privacy.tsx
// Privacy policy screen — placeholder content.
//
// REPLACE THE TEXT BELOW WITH REAL POLICY CONTENT BEFORE LAUNCH.
// Get a privacy policy reviewed by a lawyer or use a service like
// Termly / iubenda / TermsFeed to generate one specific to your data
// collection practices.

import { PolicyScreen, type PolicySection } from "@/components/PolicyScreen";

const SECTIONS: PolicySection[] = [
  {
    heading: "What we collect",
    body:
      "When you use Hidden Plate, we collect information you provide directly: " +
      "your email address, display name, username, optional bio, and optional " +
      "profile photo. When you write reviews or save restaurants, we store " +
      "that activity associated with your account.",
  },
  {
    heading: "How we use it",
    body:
      "Your account information is used to identify you on the platform and " +
      "display your content to other users. Your reviews, ratings, and " +
      "profile information are visible to all users. Your saved restaurants " +
      "(favorites, want-to-go, visited) are private and only visible to you.",
  },
  {
    heading: "Location data",
    body:
      "If you grant location permission, your device's approximate location " +
      "is used to show nearby restaurants in your feed. Your location is " +
      "never stored on our servers — it is used in-memory only and never " +
      "shared with other users.",
  },
  {
    heading: "Photos",
    body:
      "Photos you upload as part of reviews or as your profile avatar are " +
      "stored on our servers and displayed publicly alongside your reviews. " +
      "If you delete a photo, it is removed from our storage.",
  },
  {
    heading: "Third parties",
    body:
      "Hidden Plate uses Appwrite (a cloud database service) to store your " +
      "account and content data. We do not sell your personal data to third " +
      "parties. We do not use third-party analytics or advertising " +
      "trackers in this version of the app.",
  },
  {
    heading: "Your rights",
    body:
      "You can update or delete your reviews, saved restaurants, and profile " +
      "information at any time from within the app. To request a copy of " +
      "your data or to delete your account entirely, email " +
      "support@hiddenplateja.com — we will process your request within 30 days.",
  },
  {
    heading: "Children",
    body:
      "Hidden Plate is not directed at children under 13. We do not knowingly " +
      "collect data from anyone under 13. If you believe a child has provided " +
      "personal information to us, please contact support@hiddenplateja.com " +
      "and we will delete the account.",
  },
  {
    heading: "Changes to this policy",
    body:
      "We may update this policy from time to time. Material changes will be " +
      "communicated via in-app notification or email. Continued use of the app " +
      "after changes constitutes acceptance.",
  },
  {
    heading: "Contact",
    body:
      "Questions or concerns about your privacy? Email us at " +
      "support@hiddenplateja.com.",
  },
];

export default function PrivacyScreen() {
  return (
    <PolicyScreen
      title="Privacy Policy"
      lastUpdated="January 2026"
      intro={
        "Hidden Plate respects your privacy. This policy explains what " +
        "information we collect, how we use it, and your rights regarding " +
        "your personal data."
      }
      sections={SECTIONS}
      placeholder
    />
  );
}
