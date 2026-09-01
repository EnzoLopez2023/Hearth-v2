import { Router } from "express";
import type { HearthDatabase } from "../db/database.js";

export function createDashboardRouter(db: HearthDatabase): Router {
  const router = Router();
  router.get("/", (req, res) => {
    const householdId = req.auth!.householdId;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const maintenance = db.prepare(`
      SELECT * FROM maintenance_tasks WHERE household_id=? AND status IN ('open','in_progress')
      AND due_on IS NOT NULL AND due_on<=? ORDER BY due_on LIMIT 20
    `).all(householdId, upcoming);
    const inventory = db.prepare(`
      SELECT * FROM inventory_items WHERE household_id=?
      AND ((low_quantity IS NOT NULL AND quantity<=low_quantity) OR (expires_on IS NOT NULL AND expires_on<=?))
      ORDER BY expires_on IS NULL, expires_on LIMIT 20
    `).all(householdId, upcoming);
    const warranties = db.prepare(`
      SELECT * FROM warranties WHERE household_id=? AND expires_on IS NOT NULL AND expires_on<=?
      ORDER BY expires_on LIMIT 20
    `).all(householdId, upcoming);
    const garden = db.prepare(`
      SELECT * FROM garden_tasks WHERE household_id=? AND status IN ('open','in_progress')
      AND due_on IS NOT NULL AND due_on<=? ORDER BY due_on LIMIT 20
    `).all(householdId, upcoming);
    const yard = db.prepare(`
      SELECT * FROM yard_tasks WHERE household_id=? AND status IN ('open','in_progress')
      AND due_on IS NOT NULL AND due_on<=? ORDER BY due_on LIMIT 20
    `).all(householdId, upcoming);
    const poolRecommendations = db.prepare(`
      SELECT * FROM pool_report_recommendations WHERE household_id=? AND status='open'
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at LIMIT 20
    `).all(householdId);
    const poolReadings = db.prepare(`
      SELECT r.* FROM pool_report_results r JOIN pool_reports p ON p.id=r.report_id
      WHERE r.household_id=? AND (
        r.status IN ('low','high','unbalanced')
        OR r.value<r.min_target
        OR r.value>r.max_target
      )
      ORDER BY p.observed_at DESC LIMIT 20
    `).all(householdId);
    const shopping = db.prepare("SELECT * FROM garden_shopping WHERE household_id=? AND status='needed' ORDER BY name LIMIT 20")
      .all(householdId);
    const recipes = db.prepare("SELECT id,name,updated_at FROM recipes WHERE household_id=? ORDER BY updated_at DESC LIMIT 5")
      .all(householdId);
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM home_items WHERE household_id=@household) home_items,
        (SELECT COUNT(*) FROM maintenance_tasks WHERE household_id=@household) maintenance_tasks,
        (SELECT COUNT(*) FROM warranties WHERE household_id=@household) warranties,
        (SELECT COUNT(*) FROM maintenance_photos WHERE household_id=@household) maintenance_photos,
        (SELECT COUNT(*) FROM maintenance_costs WHERE household_id=@household) maintenance_costs,
        (SELECT COUNT(*) FROM ai_insights WHERE household_id=@household) maintenance_insights,
        (SELECT COUNT(*) FROM inventory_categories WHERE household_id=@household) inventory_categories,
        (SELECT COUNT(*) FROM inventory_locations WHERE household_id=@household) inventory_locations,
        (SELECT COUNT(*) FROM inventory_sub_locations WHERE household_id=@household) inventory_sub_locations,
        (SELECT COUNT(*) FROM inventory_items WHERE household_id=@household) inventory_items,
        (SELECT COUNT(*) FROM inventory_item_images WHERE household_id=@household) inventory_images,
        (SELECT COUNT(*) FROM yard_location WHERE household_id=@household) yard_locations,
        (SELECT COUNT(*) FROM yard_tasks WHERE household_id=@household) yard_tasks,
        (SELECT COUNT(*) FROM weather_daily WHERE household_id=@household) weather_days,
        (SELECT COUNT(*) FROM garden_fields WHERE household_id=@household) garden_fields,
        (SELECT COUNT(*) FROM garden_vegetables WHERE household_id=@household) garden_vegetables,
        (SELECT COUNT(*) FROM garden_beds WHERE household_id=@household) garden_beds,
        (SELECT COUNT(*) FROM garden_plantings WHERE household_id=@household) garden_plantings,
        (SELECT COUNT(*) FROM garden_tasks WHERE household_id=@household) garden_tasks,
        (SELECT COUNT(*) FROM garden_harvests WHERE household_id=@household) garden_harvests,
        (SELECT COUNT(*) FROM garden_settings WHERE household_id=@household) garden_settings,
        (SELECT COUNT(*) FROM garden_shopping WHERE household_id=@household) garden_shopping,
        (SELECT COUNT(*) FROM recipes WHERE household_id=@household) recipes,
        (SELECT COUNT(*) FROM recipe_ingredients WHERE household_id=@household) recipe_ingredients,
        (SELECT COUNT(*) FROM recipe_images WHERE household_id=@household) recipe_images,
        (SELECT COUNT(*) FROM pool_reports WHERE household_id=@household) pool_reports,
        (SELECT COUNT(*) FROM pool_report_results WHERE household_id=@household) pool_readings,
        (SELECT COUNT(*) FROM pool_report_recommendations WHERE household_id=@household) pool_recommendations,
        (SELECT COUNT(*) FROM pool_chemicals WHERE household_id=@household) pool_chemicals,
        (SELECT COUNT(*) FROM pool_insights WHERE household_id=@household) pool_insights
    `).get({ household: householdId }) as Record<string, number>;
    const firstRun = Object.values(counts).every((count) => count === 0);
    res.json({
      data: {
        as_of: today,
        first_run: firstRun,
        empty_message: firstRun ? "Add your first property record to begin tracking attention." : null,
        attention: { maintenance, inventory, warranties, yard, garden, pool_readings: poolReadings, pool_recommendations: poolRecommendations },
        context: { shopping, recent_recipes: recipes },
        counts
      }
    });
  });
  return router;
}
