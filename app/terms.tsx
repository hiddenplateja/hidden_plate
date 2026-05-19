// app/terms.tsx
// Terms of service screen — placeholder content.
//
// REPLACE BEFORE LAUNCH with real lawyer-reviewed terms.

import { PolicyScreen, type PolicySection } from "@/components/PolicyScreen";

const SECTIONS: PolicySection[] = [
  {
    heading: "Acceptance",
    body:
      "By creating an account or using Hidden Plate, you agree to these terms. " +
      "If you do not agree, please do not use the service.",
  },
  {
    heading: "Eligibility",
    body:
      "You must be at least 13 years old to use Hidden Plate. By creating an " +
      "account, you confirm that you meet this age requirement.",
  },
  {
    heading: "Your account",
    body:
      "You are responsible for maintaining the security of your account " +
      "password. We are not liable for any loss or damage resulting from " +
      "unauthorized access to your account due to compromised credentials.",
  },
  {
    heading: "User content",
    body:
      "You retain ownership of the reviews, photos, and other content you " +
      "post to Hidden Plate. By posting, you grant us a non-exclusive license " +
      "to display, distribute, and promote that content within the app and " +
      "for marketing the service.",
  },
  {
    heading: "Acceptable use",
    body:
      "You agree not to post content that is unlawful, defamatory, hateful, " +
      "harassing, sexually explicit, or that infringes on others' rights. " +
      "You will not impersonate other people, businesses, or restaurants. " +
      "You will not use bots, scrapers, or other automated tools to access " +
      "the service.",
  },
  {
    heading: "Reviews",
    body:
      "Reviews must reflect your genuine experience as a customer. Paid " +
      "reviews, fake reviews, and reviews from competitors of a restaurant " +
      "are prohibited and will be removed. Restaurant owners may not post " +
      "reviews of their own establishments.",
  },
  {
    heading: "Moderation",
    body:
      "We may remove any content or terminate any account that violates " +
      "these terms, at our sole discretion. Reported content is reviewed by " +
      "our team and removed if it violates these terms or applicable law.",
  },
  {
    heading: "Liability",
    body:
      "Hidden Plate is provided 'as is.' We make no warranty regarding the " +
      "accuracy of restaurant information, reviews, or availability of the " +
      "service. We are not liable for any damages arising from your use of " +
      "the service or interactions with other users.",
  },
  {
    heading: "Changes to the service",
    body:
      "We may modify, suspend, or discontinue features of the service at any " +
      "time without notice. We may change these terms; continued use after " +
      "changes constitutes acceptance.",
  },
  {
    heading: "Contact",
    body: "Questions about these terms? Email support@hiddenplateja.com.",
  },
];

export default function TermsScreen() {
  return (
    <PolicyScreen
      title="Terms of Service"
      lastUpdated="January 2026"
      intro={
        "These terms govern your use of Hidden Plate. Please read them carefully."
      }
      sections={SECTIONS}
      placeholder
    />
  );
}
