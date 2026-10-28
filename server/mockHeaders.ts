// Export header lists for MOCK mode only: a copy of the sourcing backend's PLU-381 mapper headers
// (server/src/sourcing/creatorExportCsv.ts). In live mode the headers come from the backend's /meta.
export const MOCK_DEFAULT_HEADERS: string[] = [
  "email", "first_name", "location", "language", "instagram_link", "instagram_username",
  "instagram_follower_count", "instagram_engagement_percent", "tiktok_link", "tiktok_username",
  "tiktok_follower_count", "tiktok_engagement_percent", "youtube_link", "youtube_custom_url",
  "youtube_subscriber_count", "youtube_engagement_percent", "twitter_link", "twitter_username",
  "twitter_follower_count", "twitter_engagement_percent",
];

export const MOCK_SHEETS_HEADERS: string[] = [
  "email", "first_name", "personal_intro", "location", "gender", "type_of_profile", "language",
  "contact_phone_number", "has_link_in_bio", "has_brand_deals", "promotes_affiliate_links", "has_merch",
  "links_in_bio", "external_urls", "instagram_link", "instagram_username", "instagram_biography",
  "instagram_follower_count", "instagram_engagement_percent", "instagram_most_recent_post_date",
  "instagram_media_count", "instagram_avg_likes", "instagram_avg_comments", "instagram_reels_reels_percent",
  "instagram_reels_avg_view_count", "instagram_posting_frequency_recent_months", "instagram_income_min",
  "instagram_income_max", "tiktok_link", "tiktok_username", "tiktok_biography", "tiktok_follower_count",
  "tiktok_most_recent_post_date", "tiktok_engagement_percent", "tiktok_video_count",
  "tiktok_play_count_median", "tiktok_avg_likes", "tiktok_comment_count_avg", "tiktok_download_count_avg",
  "tiktok_posting_frequency_recent_months", "youtube_link", "youtube_custom_url", "youtube_title",
  "youtube_description", "youtube_topic_details", "youtube_subscriber_count", "youtube_last_upload_date",
  "youtube_last_stream_upload_date", "youtube_shorts_percentage", "youtube_video_count",
  "youtube_engagement_percent", "youtube_avg_views_long", "youtube_avg_views_shorts",
  "youtube_avg_stream_views", "youtube_avg_stream_duration", "youtube_posting_frequency_recent_months",
  "youtube_income_min", "youtube_income_max", "onlyfans_link", "onlyfans_username", "onlyfans_full_name",
  "onlyfans_total_likes", "onlyfans_media_count", "onlyfans_last_seen", "twitter_link", "twitter_username",
  "twitter_biography", "twitter_follower_count", "twitter_most_recent_post_date", "twitter_tweets_count",
  "twitter_engagement_percent", "twitter_avg_likes", "twitch_link", "twitch_username", "twitch_displayName",
  "twitch_twitch_tracker_data_current_active_subs", "twitch_total_followers", "patreon_link",
  "hashtags_used", "response_status", "initial_email_sent", "Email 1 send date", "Client Name",
  "Client Product", "Client Sturcture", "Onboarding Link", "Email Thread ID", "Team Contact Name",
  "Thread Status", "ReplyDate", "FollowUp1Date", "FollowUp2Date", "Promo Code",
];
