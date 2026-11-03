-- WAVE C fix (shop-hof): the "Gold" name colour read as the ChampionBelt gold.
-- DESIGN: gold means champion only. The name ink moved to copper on the frontend
-- (#d9925a on ink, #7a3f12 on paper; src/components/shop/cosmetics.ts + memberName.css),
-- so the item label follows. Code 'color_gold' and value key 'gold' stay, so owned and
-- equipped rows, member_cosmetics and the frontend whitelist keep working.
update public.shop_items set label = 'Copper' where code = 'color_gold' and label <> 'Copper';
