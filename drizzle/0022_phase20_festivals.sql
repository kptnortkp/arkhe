CREATE TABLE `festivals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`status` text DEFAULT 'watching' NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`date_note` text,
	`deadline_on` text,
	`deadline_note` text,
	`fee` text,
	`place` text,
	`url` text,
	`link_label` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "festivals_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "festivals_name_length" CHECK(length(trim(name)) between 1 and 160),
	CONSTRAINT "festivals_region_check" CHECK(region in ('tr', 'abroad')),
	CONSTRAINT "festivals_status_check" CHECK(status in ('watching', 'applied', 'attending', 'declined')),
	CONSTRAINT "festivals_dates" CHECK((starts_on is null or (starts_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(starts_on) is starts_on))
        and (ends_on is null or (starts_on is not null and ends_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(ends_on) is ends_on and ends_on >= starts_on))
        and (deadline_on is null or (deadline_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(deadline_on) is deadline_on))),
	CONSTRAINT "festivals_date_note_length" CHECK(date_note is null or length(trim(date_note)) between 1 and 80),
	CONSTRAINT "festivals_deadline_note_length" CHECK(deadline_note is null or length(trim(deadline_note)) between 1 and 160),
	CONSTRAINT "festivals_fee_length" CHECK(fee is null or length(trim(fee)) between 1 and 160),
	CONSTRAINT "festivals_place_length" CHECK(place is null or length(trim(place)) between 1 and 120),
	CONSTRAINT "festivals_url_check" CHECK(url is null or ((substr(url, 1, 8) = 'https://' or substr(url, 1, 7) = 'http://') and length(url) <= 2000)),
	CONSTRAINT "festivals_link_label_length" CHECK(link_label is null or length(trim(link_label)) between 1 and 160),
	CONSTRAINT "festivals_note_length" CHECK(note is null or length(trim(note)) between 1 and 1000)
);
--> statement-breakpoint
CREATE INDEX `festivals_starts_idx` ON `festivals` (`starts_on`);--> statement-breakpoint
CREATE INDEX `festivals_deadline_idx` ON `festivals` (`deadline_on`) WHERE deadline_on is not null;--> statement-breakpoint
CREATE TABLE `special_days` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "special_days_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "special_days_day_format" CHECK(day glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(day) is day),
	CONSTRAINT "special_days_title_length" CHECK(length(trim(title)) between 1 and 80),
	CONSTRAINT "special_days_kind_check" CHECK(kind in ('holiday', 'eve', 'observance', 'other'))
);
--> statement-breakpoint
CREATE INDEX `special_days_day_idx` ON `special_days` (`day`);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('0ce545ae-9fb6-5906-859f-40f1e975c9d1', 'Korolar Maratonu + Birlikte Söyle (2026)', 'tr', 'attending', '2026-12-11', '2026-12-13', NULL, '2026-11-08', '21 Ekim – 8 Kasım', 'KKD üyelerine ücretsiz', 'Ankara', 'https://drive.google.com/file/d/1U3zna_jNtIMzNjZjceUSiKbr8Tf96Zvc/view', 'Korolar Maratonu 2026 – Katılım Koşulları.pdf', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('6b730e70-4a7d-5573-b0ed-4c4133c94245', 'Türkiye Korolar Şenliği', 'tr', 'watching', '2027-04-17', '2027-04-18', NULL, NULL, 'Henüz açıklanmadı', 'Erişilemedi', 'Ankara', 'https://www.turkiyekorolarsenligi.org/', 'Türkiye Korolar Şenliği', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('a2252649-317e-5bb1-a0b6-74f2be092f7f', 'SANSEV Uluslararası İstanbul Koro Şenliği', 'tr', 'watching', '2027-05-06', '2027-05-09', NULL, '2026-12-26', NULL, '10.000 TL + KDV', 'İstanbul', 'https://sansev.org/istkorofest/', '12. Sansev İstanbul Uluslararası Çoksesli Koro Festivali', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('79582079-aec8-5733-bde2-eec78088423f', 'İzmir Uluslararası Korolar Festivali', 'tr', 'watching', '2027-05-20', '2027-05-23', NULL, NULL, 'Henüz açıklanmadı', 'Ücretsiz', 'İzmir', 'https://ebelge.izmir.bel.tr/2026_izmir_festival_sartnamesi.pdf', 'İzmir Uluslararası Çoksesli Korolar Festivali 2026', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('94527c11-57f9-5421-8635-56ed4dc648da', 'Alanya & Manavgat Uluslararası Koro Festivali', 'tr', 'watching', '2027-05-25', '2027-05-30', NULL, '2026-11-01', NULL, '205 € (konaklama dahil kişi başı)', 'Antalya', 'https://folklorfest.com/tr/tour/international-alanyamanavgat-choire-festival-competition-conditions/', 'Uluslararası Alanya & Manavgat Koro Festivali / Yarışma koşulları', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('e61d0f91-f11e-52d2-9a06-37531917aeba', 'Trabzon 3. Koro Festivali', 'tr', 'watching', '2027-06-10', '2027-06-13', NULL, '2026-11-15', NULL, 'Erişilemedi', 'Trabzon', 'https://www.trabzonkorofestivali.com/', 'Trabzon Koro Festivali', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('adfe2199-a4b2-50df-9b03-3805a5701e29', 'Çanakkale Uluslararası Koro Festivali', 'tr', 'watching', '2027-07-06', '2027-07-11', NULL, NULL, 'Henüz açıklanmadı', 'Erişilemedi', 'Çanakkale', NULL, NULL, NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('07c49ae9-f917-5768-bd0f-e6b23e233eb0', 'Uluslararası İstanbul Koro Festivali (İBB)', 'tr', 'watching', '2027-07-08', '2027-07-11', NULL, NULL, 'Henüz açıklanmadı', 'Ücretsiz', 'İstanbul', 'https://orkestralar.ibb.istanbul/4-uluslararasi-istanbul-koro-festivali-4th-international-istanbul-choir-festival/', 'Uluslararası İstanbul Koro Festivali', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('e2bd0196-63f2-5314-bfd5-9f1e0acd40f7', 'Akdeniz Üniversitesi Koro Festivali', 'tr', 'watching', NULL, NULL, 'Kasım 2027', NULL, 'Eylül (tam tarih belli değil)', 'Ücretsiz', 'Antalya', 'https://www.akdenizkorofest.org/festivalsartlar', 'Akdeniz Koro Fest', '2027 için not edilmiştir.', unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('3ff41222-dbb4-5ce6-b15d-2308ff26f59c', 'Cork Uluslararası Koro Festivali', 'abroad', 'watching', '2027-04-28', '2027-05-02', NULL, '2027-02-05', '15 Ocak – 5 Şubat', 'Koro başı en az 350 €', 'İrlanda', 'https://www.corkchoral.ie/', 'Cork International Choral Festival', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('8eb93775-6bd4-580c-b1d4-074c6e6a16ef', 'Bratislava Koro ve Orkestra Festivali', 'abroad', 'watching', '2027-06-10', '2027-06-13', NULL, '2027-03-01', NULL, '200 € (1 Nisan''a kadar %50 indirimli ödeme)', 'Slovakya', 'https://www.choral-music.sk/en/Festivaly/view/id:224/section:registration_info', 'Bratislava Choir & Orchestra Festival', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('10600442-5686-5441-a3d7-68f3172de876', '16. Uluslararası Cracov Koro Festivali', 'abroad', 'watching', '2027-06-10', '2027-06-13', NULL, '2026-11-30', NULL, '200 € (aktivite başına)', 'Polonya', 'https://www.krakowchoirfestival.pl/rules_application.html', 'Cracovia Cantans', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('0a9e96b9-4807-56ea-84c5-a661db9d2f52', 'International Festival “Summer in Tbilisi”', 'abroad', 'watching', '2027-06-18', '2027-06-22', NULL, '2027-02-12', NULL, '270 €', 'Gürcistan', NULL, NULL, NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('e7863e7c-179f-5596-ac6a-78039f78d4d4', 'Musica Orbis – Prague Festival', 'abroad', 'watching', '2027-07-01', '2027-07-05', NULL, '2026-12-15', 'Erken kayıt: 15 Aralık 2026', NULL, 'Prag', 'https://www.musicaorbis.com/prague-festival/2027/', NULL, 'Yarışma.', unixepoch());--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('bd46af60-4e44-5971-8a60-235bae14facc', 'Singapur Uluslararası Korolar Festivali', 'abroad', 'watching', '2027-07-15', '2027-07-19', NULL, '2026-12-31', 'Erken kayıt 31 Aralık; son 15 Nisan', '500 Singapur doları, etkinlik başına 250 $', 'Singapur', NULL, NULL, NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('b16cc967-e632-5f82-a875-a73b9450373f', 'Bratislava Cantat II', 'abroad', 'watching', '2027-10-07', '2027-10-10', NULL, NULL, 'Tarih belirtilmemiş', NULL, 'Bratislava', 'https://www.choral-music.sk/en/festivaly/listing', NULL, NULL, unixepoch());--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('6f5a0fd5-f15c-502e-8ad8-528f1ae8f747', 'Dünya Koro Oyunları', 'abroad', 'watching', '2027-07-21', '2027-07-31', NULL, '2027-01-20', 'Erken kayıt 4 Kasım; son 20 Ocak', '300 € (aktivite başına, erken kayıt)', 'Avusturya', 'https://www.interkultur.com/about/world-choir-games', 'World Choir Games – INTERKULTUR', 'Ücret ayrıntısı: https://drive.google.com/file/d/1sDy0181cxIoTX0YPqIeMJ9-1Gw3zIkAR/view', unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('20035a7b-8520-5916-8305-12793e686007', 'Floransa Uluslararası Koro Festivali', 'abroad', 'watching', '2027-07-27', '2027-07-30', NULL, NULL, 'Henüz açıklanmadı', '200 € katılım, etkinlik başına 150 € ekstra', 'İtalya', 'https://www.florencechoirfestival.com/FICF_general-information.php', 'General information – Florence International Choir Festival', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('2e4afb3d-b070-5001-8b8d-b4ba7c118846', 'Europa Cantat Festival', 'abroad', 'watching', '2027-08-09', '2027-08-15', NULL, '2027-01-15', NULL, '200 € (kişi başı)', 'Letonya', NULL, NULL, NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `festivals` (`id`,`name`,`region`,`status`,`starts_on`,`ends_on`,`date_note`,`deadline_on`,`deadline_note`,`fee`,`place`,`url`,`link_label`,`note`,`created_at`) VALUES ('89d49507-245f-5914-a5b3-70411076266f', 'Béla Bartók Uluslararası Koro Yarışması', 'abroad', 'watching', '2028-07-06', '2028-07-09', NULL, NULL, 'Henüz açıklanmadı', NULL, 'Macaristan', 'https://bartokcompetition.hu/en/home/', 'Béla Bartók Choir Competition', NULL, unixepoch() - 5184000);--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('4ea4aebd-f3e9-5988-b66c-df99d39a4b3e', '2026-10-28', 'Cumhuriyet Bayramı arifesi', 'eve');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('ca24f9d4-7cff-5550-b7c8-ecf087634d4f', '2026-10-29', 'Cumhuriyet Bayramı', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('52378d4b-e09c-5caa-97fc-ca24e91b18e4', '2026-11-10', 'Atatürk''ü Anma Günü', 'observance');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('522dfec2-f05f-5b1f-af61-ea34c7a7580d', '2026-12-21', 'En uzun gece', 'other');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('814486d0-160e-58a8-bb48-0e8b5294c4c0', '2027-01-01', 'Yılbaşı', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('b0bc1b4a-dd1c-5731-8502-9fcd1b48d2bb', '2027-03-08', 'Ramazan Bayramı arifesi', 'eve');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('1525bb6e-8a02-57d2-8807-4e0a9f71e520', '2027-03-09', 'Ramazan Bayramı 1. gün', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('00bd0168-d5d2-5bda-bd78-b24785c25df7', '2027-03-10', 'Ramazan Bayramı 2. gün', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('a08f4202-0509-5d3d-86a5-828b2f0998b7', '2027-03-11', 'Ramazan Bayramı 3. gün', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('b43e25e4-376c-59b6-8b98-6f2ffbcbac38', '2027-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('3e8c5126-40f8-5659-a75d-086de9496893', '2027-05-01', 'Emek ve Dayanışma Günü', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('c9a2acc7-faee-5d50-b314-6a424bfa2978', '2027-05-15', 'Kurban Bayramı arifesi', 'eve');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('cd4b1e39-2b12-55f4-814b-74a553be6799', '2027-05-16', 'Kurban Bayramı 1. gün', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('1fdd5430-f842-5166-80d3-501146390ae1', '2027-05-17', 'Kurban Bayramı 2. gün', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('1aca290d-8308-5d35-b5fd-03c0985e5a9a', '2027-05-18', 'Kurban Bayramı 3. gün', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('a533fc75-8612-5059-9675-fbebadceeafb', '2027-05-19', 'Kurban Bayramı 4. gün · 19 Mayıs', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('7eb5e051-2c83-560a-b223-ee80b4ed1b06', '2027-07-15', 'Demokrasi ve Milli Birlik Günü', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('20acfe77-00bf-5b88-b03f-dc9b908f8264', '2027-08-30', 'Zafer Bayramı', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('b47890fb-569e-5ee5-85f4-eda6af6aca24', '2027-10-28', 'Cumhuriyet Bayramı arifesi', 'eve');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('b0291676-f40c-5513-84ad-efe3f4e5be8d', '2027-10-29', 'Cumhuriyet Bayramı', 'holiday');--> statement-breakpoint
INSERT OR IGNORE INTO `special_days` (`id`,`day`,`title`,`kind`) VALUES ('6427344e-eb4d-515a-8949-81375d6b58c3', '2027-11-10', 'Atatürk''ü Anma Günü', 'observance');
