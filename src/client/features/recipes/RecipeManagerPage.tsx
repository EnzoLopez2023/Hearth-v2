import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChefHat,
  Clock3,
  ExternalLink,
  FileText,
  Heart,
  Image as ImageIcon,
  Link2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, apiBlob, apiMessage } from "../../api";
import { PageHero } from "../../components/PageHero";

const mealTypes = ["breakfast", "lunch", "dinner", "snack", "dessert", "appetizer"] as const;
const difficulties = ["easy", "medium", "hard"] as const;

interface Nutrition {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  serving_size?: string | null;
  glycemic_load?: number | null;
  weight_per_serving_g?: number | null;
}

interface RecipeImage {
  id?: string;
  blob_id: string;
  alt_text: string | null;
  position?: number;
  url: string;
}

interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  position: number;
}

interface RecipeSummary {
  id: string;
  name: string;
  description: string | null;
  cuisine_type: string | null;
  meal_type: string;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  servings: number | null;
  difficulty_level: string;
  instructions: string | null;
  notes: string | null;
  source_url: string | null;
  is_favorite: boolean;
  rating: number | null;
  parsed_by_ai: boolean;
  ai_suggestions: string | null;
  tags: string[];
  nutrition: Nutrition | null;
  ingredient_count: number;
  primary_image: RecipeImage | null;
  created_at: string;
  updated_at: string;
}

interface RecipeDetail extends RecipeSummary {
  ingredients: RecipeIngredient[];
  images: RecipeImage[];
}

interface IngredientDraft {
  id: string | null;
  name: string;
  quantity: string;
  unit: string;
  notes: string;
}

interface RecipeDraft {
  name: string;
  description: string;
  cuisine_type: string;
  meal_type: typeof mealTypes[number];
  prep_minutes: string;
  cook_minutes: string;
  servings: string;
  difficulty_level: typeof difficulties[number];
  instructions: string;
  notes: string;
  source_url: string;
  tags: string;
  is_favorite: boolean;
  rating: string;
  parsed_by_ai: boolean;
  nutrition: Nutrition | null;
  ingredients: IngredientDraft[];
}

interface RecipePayload {
  name: string;
  description: string | null;
  cuisine_type: string | null;
  meal_type: typeof mealTypes[number];
  prep_minutes: number | null;
  cook_minutes: number | null;
  servings: number | null;
  difficulty_level: typeof difficulties[number];
  instructions: string | null;
  notes: string | null;
  source_url: string | null;
  tags: string[];
  is_favorite: boolean;
  rating: number | null;
  parsed_by_ai: boolean;
  nutrition: Nutrition | null;
  ingredients: Array<{
    id?: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
  }>;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function ingredientQuantity(ingredient: RecipeIngredient): string {
  if (ingredient.quantity === null) return "";
  const quantity = compactNumber(ingredient.quantity);
  return ingredient.unit ? `${quantity} ${ingredient.unit}` : quantity;
}

function totalMinutes(recipe: RecipeSummary): number | null {
  if (recipe.total_minutes !== null && recipe.total_minutes > 0) return recipe.total_minutes;
  if (recipe.prep_minutes === null && recipe.cook_minutes === null) return null;
  return (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
}

function netCarbs(recipe: RecipeSummary): number | null {
  const carbs = recipe.nutrition?.carbs_g;
  if (carbs === null || carbs === undefined) return null;
  return Math.max(0, carbs - (recipe.nutrition?.fiber_g ?? 0));
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function emptyDraft(): RecipeDraft {
  return {
    name: "",
    description: "",
    cuisine_type: "",
    meal_type: "dinner",
    prep_minutes: "",
    cook_minutes: "",
    servings: "4",
    difficulty_level: "medium",
    instructions: "",
    notes: "",
    source_url: "",
    tags: "",
    is_favorite: false,
    rating: "",
    parsed_by_ai: false,
    nutrition: null,
    ingredients: []
  };
}

function detailDraft(recipe: RecipeDetail): RecipeDraft {
  return {
    name: recipe.name,
    description: recipe.description ?? "",
    cuisine_type: recipe.cuisine_type ?? "",
    meal_type: mealTypes.includes(recipe.meal_type as typeof mealTypes[number])
      ? recipe.meal_type as typeof mealTypes[number]
      : "dinner",
    prep_minutes: recipe.prep_minutes === null ? "" : String(recipe.prep_minutes),
    cook_minutes: recipe.cook_minutes === null ? "" : String(recipe.cook_minutes),
    servings: recipe.servings === null ? "" : String(recipe.servings),
    difficulty_level: difficulties.includes(recipe.difficulty_level as typeof difficulties[number])
      ? recipe.difficulty_level as typeof difficulties[number]
      : "medium",
    instructions: recipe.instructions ?? "",
    notes: recipe.notes ?? "",
    source_url: recipe.source_url ?? "",
    tags: recipe.tags.join(", "),
    is_favorite: recipe.is_favorite,
    rating: recipe.rating === null || recipe.rating <= 0 ? "" : String(recipe.rating),
    parsed_by_ai: recipe.parsed_by_ai,
    nutrition: recipe.nutrition,
    ingredients: recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      quantity: ingredient.quantity === null ? "" : String(ingredient.quantity),
      unit: ingredient.unit ?? "",
      notes: ingredient.notes ?? ""
    }))
  };
}

function recipePayload(draft: RecipeDraft): RecipePayload {
  return {
    name: draft.name.trim(),
    description: textOrNull(draft.description),
    cuisine_type: textOrNull(draft.cuisine_type),
    meal_type: draft.meal_type,
    prep_minutes: numberOrNull(draft.prep_minutes),
    cook_minutes: numberOrNull(draft.cook_minutes),
    servings: numberOrNull(draft.servings),
    difficulty_level: draft.difficulty_level,
    instructions: textOrNull(draft.instructions),
    notes: textOrNull(draft.notes),
    source_url: textOrNull(draft.source_url),
    tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    is_favorite: draft.is_favorite,
    rating: numberOrNull(draft.rating),
    parsed_by_ai: draft.parsed_by_ai,
    nutrition: draft.nutrition,
    ingredients: draft.ingredients.map((ingredient) => ({
      ...(ingredient.id ? { id: ingredient.id } : {}),
      name: ingredient.name.trim(),
      quantity: numberOrNull(ingredient.quantity),
      unit: textOrNull(ingredient.unit),
      notes: textOrNull(ingredient.notes)
    }))
  };
}

function payloadDraft(payload: RecipePayload): RecipeDraft {
  return {
    name: payload.name,
    description: payload.description ?? "",
    cuisine_type: payload.cuisine_type ?? "",
    meal_type: payload.meal_type,
    prep_minutes: payload.prep_minutes === null ? "" : String(payload.prep_minutes),
    cook_minutes: payload.cook_minutes === null ? "" : String(payload.cook_minutes),
    servings: payload.servings === null ? "" : String(payload.servings),
    difficulty_level: payload.difficulty_level,
    instructions: payload.instructions ?? "",
    notes: payload.notes ?? "",
    source_url: payload.source_url ?? "",
    tags: payload.tags.join(", "),
    is_favorite: payload.is_favorite,
    rating: payload.rating === null ? "" : String(payload.rating),
    parsed_by_ai: payload.parsed_by_ai,
    nutrition: payload.nutrition,
    ingredients: payload.ingredients.map((ingredient) => ({
      id: null,
      name: ingredient.name,
      quantity: ingredient.quantity === null ? "" : String(ingredient.quantity),
      unit: ingredient.unit ?? "",
      notes: ingredient.notes ?? ""
    }))
  };
}

function instructionSteps(instructions: string): string[] {
  const numbered = instructions
    .split(/(?:^|\n)\s*(?:step\s*)?\d+[.)\s:-]+/i)
    .map((step) => step.trim())
    .filter(Boolean);
  if (numbered.length > 1) return numbered;
  const lines = instructions.split(/\n+/).map((step) => step.trim()).filter(Boolean);
  return lines.length > 1 ? lines : [instructions.trim()];
}

function RecipeImageView({
  image,
  className
}: {
  image: RecipeImage;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    apiBlob(image.url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.url]);

  if (!src || failed) {
    return <span className={`${className ?? ""} recipe-image-fallback`} aria-label={failed ? "Recipe image unavailable" : "Loading recipe image"}><ImageIcon aria-hidden="true" /></span>;
  }
  return <img className={className} src={src} alt={image.alt_text ?? ""} />;
}

function RecipeCard({
  recipe,
  busyFavorite,
  onOpen,
  onEdit,
  onDelete,
  onFavorite
}: {
  recipe: RecipeSummary;
  busyFavorite: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
}) {
  const minutes = totalMinutes(recipe);
  const carbs = netCarbs(recipe);
  return (
    <article className="recipe-card">
      <button className="recipe-card-open" type="button" onClick={onOpen} aria-label={`Open ${recipe.name}`}>
        <div className="recipe-card-image">
          {recipe.primary_image
            ? <RecipeImageView image={recipe.primary_image} />
            : <span className="recipe-image-fallback" aria-hidden="true"><BookOpen /></span>}
        </div>
        <div className="recipe-card-copy">
          <div className="recipe-card-title-row">
            <h2>{recipe.name}</h2>
            {recipe.rating !== null && recipe.rating > 0 && (
              <span className="recipe-rating"><Star aria-hidden="true" />{compactNumber(recipe.rating)}</span>
            )}
          </div>
          {recipe.description && <p>{recipe.description}</p>}
          <div className="recipe-chips" aria-label="Recipe details">
            {recipe.cuisine_type && <span>{recipe.cuisine_type}</span>}
            <span>{titleCase(recipe.meal_type)}</span>
            <span className={`difficulty difficulty-${recipe.difficulty_level}`}>{titleCase(recipe.difficulty_level)}</span>
          </div>
          <dl className="recipe-card-meta">
            {minutes !== null && <div><dt><Clock3 aria-hidden="true" />Time</dt><dd>{minutes} min</dd></div>}
            {recipe.servings !== null && <div><dt><Users aria-hidden="true" />Serves</dt><dd>{recipe.servings}</dd></div>}
            <div><dt><ChefHat aria-hidden="true" />Ingredients</dt><dd>{recipe.ingredient_count}</dd></div>
            {carbs !== null && <div><dt>Net carbs</dt><dd>{compactNumber(carbs)}g</dd></div>}
          </dl>
        </div>
      </button>
      <button
        className={`recipe-favorite${recipe.is_favorite ? " is-active" : ""}`}
        type="button"
        aria-label={recipe.is_favorite ? `Remove ${recipe.name} from favorites` : `Add ${recipe.name} to favorites`}
        aria-pressed={recipe.is_favorite}
        disabled={busyFavorite}
        onClick={onFavorite}
      >
        <Heart aria-hidden="true" />
      </button>
      <footer className="recipe-card-actions">
        <span>{recipe.tags.slice(0, 2).join(" · ") || "Household recipe"}</span>
        <div>
          <button className="icon-button" type="button" onClick={onEdit} aria-label={`Edit ${recipe.name}`}><Pencil aria-hidden="true" /></button>
          <button className="icon-button danger" type="button" onClick={onDelete} aria-label={`Delete ${recipe.name}`}><Trash2 aria-hidden="true" /></button>
        </div>
      </footer>
    </article>
  );
}

function RecipeEditor({
  recipe,
  initialDraft,
  aiAssisted,
  busy,
  error,
  onClose,
  onSave
}: {
  recipe: RecipeDetail | null;
  initialDraft?: RecipeDraft;
  aiAssisted: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: RecipePayload) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<RecipeDraft>(() => recipe ? detailDraft(recipe) : initialDraft ?? emptyDraft());
  useEffect(() => { dialog.current?.showModal(); }, []);

  const updateIngredient = (index: number, field: keyof IngredientDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, itemIndex) =>
        itemIndex === index ? { ...ingredient, [field]: value } : ingredient)
    }));
  };
  const moveIngredient = (index: number, offset: -1 | 1) => {
    setDraft((current) => {
      const destination = index + offset;
      if (destination < 0 || destination >= current.ingredients.length) return current;
      const ingredients = [...current.ingredients];
      const currentIngredient = ingredients[index];
      const destinationIngredient = ingredients[destination];
      if (!currentIngredient || !destinationIngredient) return current;
      ingredients[index] = destinationIngredient;
      ingredients[destination] = currentIngredient;
      return { ...current, ingredients };
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(recipePayload(draft));
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-dialog recipe-editor"
      aria-labelledby="recipe-editor-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <form onSubmit={submit}>
        <header className="recipe-dialog-heading">
          <div>
            <h2 id="recipe-editor-title">{recipe ? "Edit recipe" : aiAssisted ? "Review AI recipe" : "Add a recipe"}</h2>
            <p>{aiAssisted
              ? "Check the extracted details before adding this recipe to your collection."
              : "Keep the details you rely on while shopping, cooking, and serving."}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close recipe form"><X aria-hidden="true" /></button>
        </header>

        <div className="recipe-editor-body">
          {aiAssisted && (
            <div className="ai-review-note" role="status">
              <Sparkles aria-hidden="true" />
              <p><strong>AI prepared this draft.</strong> Nothing is saved until you review the source details and choose Save recipe.</p>
            </div>
          )}
          <fieldset disabled={busy}>
            <legend>Recipe essentials</legend>
            <div className="recipe-form-grid">
              <label className="field-wide">
                <span>Recipe title <b aria-hidden="true">*</b></span>
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={500} />
              </label>
              <label className="field-wide">
                <span>Description</span>
                <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} />
              </label>
              <label>
                <span>Cuisine</span>
                <input value={draft.cuisine_type} onChange={(event) => setDraft({ ...draft, cuisine_type: event.target.value })} placeholder="Italian, Mexican, Southern" />
              </label>
              <label>
                <span>Meal type</span>
                <select value={draft.meal_type} onChange={(event) => setDraft({ ...draft, meal_type: event.target.value as RecipeDraft["meal_type"] })}>
                  {mealTypes.map((mealType) => <option key={mealType} value={mealType}>{titleCase(mealType)}</option>)}
                </select>
              </label>
              <label>
                <span>Difficulty</span>
                <select value={draft.difficulty_level} onChange={(event) => setDraft({ ...draft, difficulty_level: event.target.value as RecipeDraft["difficulty_level"] })}>
                  {difficulties.map((difficulty) => <option key={difficulty} value={difficulty}>{titleCase(difficulty)}</option>)}
                </select>
              </label>
              <label>
                <span>Rating</span>
                <select value={draft.rating} onChange={(event) => setDraft({ ...draft, rating: event.target.value })}>
                  <option value="">Not rated</option>
                  {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}
                </select>
              </label>
              <label>
                <span>Prep time</span>
                <div className="input-suffix"><input type="number" min="0" step="1" value={draft.prep_minutes} onChange={(event) => setDraft({ ...draft, prep_minutes: event.target.value })} /><span>min</span></div>
              </label>
              <label>
                <span>Cook time</span>
                <div className="input-suffix"><input type="number" min="0" step="1" value={draft.cook_minutes} onChange={(event) => setDraft({ ...draft, cook_minutes: event.target.value })} /><span>min</span></div>
              </label>
              <label>
                <span>Servings</span>
                <input type="number" min="1" step="1" value={draft.servings} onChange={(event) => setDraft({ ...draft, servings: event.target.value })} />
              </label>
              <label>
                <span>Source URL</span>
                <input type="url" value={draft.source_url} onChange={(event) => setDraft({ ...draft, source_url: event.target.value })} placeholder="https://example.com/recipe" />
              </label>
              <label className="field-wide">
                <span>Tags</span>
                <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="weeknight, comfort food, vegetarian" />
                <small>Separate tags with commas.</small>
              </label>
              <label className="recipe-check">
                <input type="checkbox" checked={draft.is_favorite} onChange={(event) => setDraft({ ...draft, is_favorite: event.target.checked })} />
                <span>Keep this recipe in favorites</span>
              </label>
            </div>
          </fieldset>

          <fieldset disabled={busy}>
            <div className="recipe-fieldset-heading">
              <legend>Ingredients</legend>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, { id: null, name: "", quantity: "", unit: "", notes: "" }] })}
              >
                <Plus aria-hidden="true" />Add ingredient
              </button>
            </div>
            {draft.ingredients.length === 0 ? (
              <p className="ingredient-empty">Add ingredients in the order you use them.</p>
            ) : (
              <div className="ingredient-editor-list">
                {draft.ingredients.map((ingredient, index) => (
                  <div className="ingredient-editor-row" key={index}>
                    <span className="ingredient-position">{index + 1}</span>
                    <label>
                      <span>Ingredient</span>
                      <input value={ingredient.name} onChange={(event) => updateIngredient(index, "name", event.target.value)} required />
                    </label>
                    <label>
                      <span>Quantity</span>
                      <input type="number" min="0.01" step="any" value={ingredient.quantity} onChange={(event) => updateIngredient(index, "quantity", event.target.value)} />
                    </label>
                    <label>
                      <span>Unit</span>
                      <input value={ingredient.unit} onChange={(event) => updateIngredient(index, "unit", event.target.value)} placeholder="cup, tbsp, oz" />
                    </label>
                    <label>
                      <span>Preparation note</span>
                      <input value={ingredient.notes} onChange={(event) => updateIngredient(index, "notes", event.target.value)} placeholder="diced, divided, to taste" />
                    </label>
                    <div className="ingredient-row-actions">
                      <button className="icon-button" type="button" onClick={() => moveIngredient(index, -1)} disabled={index === 0} aria-label={`Move ${ingredient.name || `ingredient ${index + 1}`} up`}><ArrowUp aria-hidden="true" /></button>
                      <button className="icon-button" type="button" onClick={() => moveIngredient(index, 1)} disabled={index === draft.ingredients.length - 1} aria-label={`Move ${ingredient.name || `ingredient ${index + 1}`} down`}><ArrowDown aria-hidden="true" /></button>
                      <button className="icon-button danger" type="button" onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove ${ingredient.name || `ingredient ${index + 1}`}`}><Trash2 aria-hidden="true" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Method and notes</legend>
            <div className="recipe-form-grid">
              <label className="field-wide">
                <span>Instructions</span>
                <textarea value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} rows={8} placeholder="Write each step on a new line." />
              </label>
              <label className="field-wide">
                <span>Recipe notes</span>
                <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} placeholder="Substitutions, serving ideas, or what to change next time." />
              </label>
            </div>
          </fieldset>

          {recipe && recipe.images.length > 0 && (
            <section className="editor-photo-strip" aria-labelledby="saved-recipe-photos">
              <div>
                <h3 id="saved-recipe-photos">Saved photos</h3>
                <p>Photos imported with this recipe remain attached.</p>
              </div>
              <div>{recipe.images.map((image) => <RecipeImageView key={image.id ?? image.blob_id} image={image} />)}</div>
            </section>
          )}
          {error && <div className="inline-error" role="alert">{error}</div>}
        </div>

        <footer className="recipe-dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving recipe..." : "Save recipe"}</button>
        </footer>
      </form>
    </dialog>
  );
}

type AiImportMode = "text" | "url";

function aiProviderLabel(provider: string): string {
  if (provider === "azure-openai") return "Azure OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "AI";
}

function RecipeAiImportDialog({
  configured,
  provider,
  busy,
  error,
  onClose,
  onExtract
}: {
  configured: boolean;
  provider: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onExtract: (mode: AiImportMode, value: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<AiImportMode>("text");
  const [recipeText, setRecipeText] = useState("");
  const [recipeUrl, setRecipeUrl] = useState("");
  const value = mode === "text" ? recipeText.trim() : recipeUrl.trim();
  useEffect(() => { dialog.current?.showModal(); }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onExtract(mode, value);
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-dialog ai-import-dialog"
      aria-labelledby="ai-import-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    >
      <form onSubmit={submit}>
        <header className="recipe-dialog-heading">
          <div>
            <h2 id="ai-import-title">Add with AI</h2>
            <p>Turn recipe text or a public recipe page into an editable draft.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close AI recipe import"><X aria-hidden="true" /></button>
        </header>

        <div className="ai-import-body">
          <div className={`ai-provider-note${configured ? "" : " is-unconfigured"}`}>
            <Sparkles aria-hidden="true" />
            <div>
              <strong>{configured ? `${aiProviderLabel(provider)} is ready` : "AI import is not configured"}</strong>
              <p>{configured
                ? "Your source is sent to the configured provider only to structure a recipe draft. Review it before saving."
                : "Configure Azure OpenAI or Anthropic on this Hearth deployment to use AI-assisted recipe import."}</p>
            </div>
          </div>

          <div className="ai-import-modes" aria-label="Recipe import source">
            <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}><FileText aria-hidden="true" />Paste recipe text</button>
            <button type="button" aria-pressed={mode === "url"} onClick={() => setMode("url")}><Link2 aria-hidden="true" />Import website</button>
          </div>

          {mode === "text" ? (
            <label className="ai-import-field">
              <span>Recipe text</span>
              <textarea
                value={recipeText}
                onChange={(event) => setRecipeText(event.target.value)}
                placeholder={"Chewy granola bars\n\nIngredients\n2 cups rolled oats...\n\nInstructions\n1. Heat the oven..."}
                rows={12}
                minLength={20}
                maxLength={50_000}
                required
                autoFocus
              />
              <small>Include the title, ingredients, instructions, timing, and any notes you want preserved.</small>
            </label>
          ) : (
            <label className="ai-import-field">
              <span>Public recipe URL</span>
              <input
                type="url"
                value={recipeUrl}
                onChange={(event) => setRecipeUrl(event.target.value)}
                placeholder="https://example.com/recipe"
                maxLength={2_048}
                required
                autoFocus
              />
              <small>Some sites block automated reading. If that happens, copy the recipe and use Paste recipe text.</small>
            </label>
          )}

          {error && <div className="inline-error" role="alert">{error}</div>}
        </div>

        <footer className="recipe-dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={!configured || busy || !value}>
            <Sparkles aria-hidden="true" />{busy ? "Structuring recipe..." : "Create AI draft"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function NutritionPanel({ nutrition }: { nutrition: Nutrition }) {
  const tiles = [
    ["Calories", nutrition.calories, "kcal"],
    ["Protein", nutrition.protein_g, "g"],
    ["Total carbs", nutrition.carbs_g, "g"],
    ["Fat", nutrition.fat_g, "g"],
    ["Fiber", nutrition.fiber_g, "g"],
    ["Sugar", nutrition.sugar_g, "g"],
    ["Sodium", nutrition.sodium_mg, "mg"]
  ] as const;
  const carbs = nutrition.carbs_g;
  const net = carbs === null || carbs === undefined ? null : Math.max(0, carbs - (nutrition.fiber_g ?? 0));
  return (
    <section className="recipe-detail-section nutrition-panel">
      <div className="detail-section-heading">
        <h3>Nutrition per serving</h3>
        {nutrition.serving_size && <span>{nutrition.serving_size}</span>}
      </div>
      {net !== null && (
        <div className="net-carb-feature">
          <strong>{compactNumber(net)}g</strong>
          <span>Net carbs</span>
          <small>{compactNumber(carbs ?? 0)}g total - {compactNumber(nutrition.fiber_g ?? 0)}g fiber</small>
        </div>
      )}
      <dl className="nutrition-grid">
        {tiles.filter(([, value]) => value !== null && value !== undefined).map(([label, value, unit]) => (
          <div key={label}><dd>{compactNumber(value ?? 0)}<small>{unit}</small></dd><dt>{label}</dt></div>
        ))}
      </dl>
    </section>
  );
}

function RecipeDetailDialog({
  recipe,
  busy,
  onClose,
  onEdit,
  onDelete,
  onFavorite
}: {
  recipe: RecipeDetail;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const minutes = totalMinutes(recipe);
  const steps = recipe.instructions ? instructionSteps(recipe.instructions) : [];
  return (
    <dialog
      ref={dialog}
      className="recipe-dialog recipe-detail-dialog"
      aria-labelledby="recipe-detail-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <header className="recipe-detail-header">
        {recipe.primary_image
          ? <RecipeImageView image={recipe.primary_image} className="recipe-detail-cover" />
          : <span className="recipe-detail-cover recipe-image-fallback" aria-hidden="true"><BookOpen /></span>}
        <div className="recipe-detail-title">
          <div className="recipe-detail-kicker">
            <span>{recipe.cuisine_type || "From your kitchen"}</span>
            <button
              className={`recipe-detail-favorite${recipe.is_favorite ? " is-active" : ""}`}
              type="button"
              aria-pressed={recipe.is_favorite}
              onClick={onFavorite}
              disabled={busy}
            >
              <Heart aria-hidden="true" />{recipe.is_favorite ? "Favorite" : "Add to favorites"}
            </button>
          </div>
          <h2 id="recipe-detail-title">{recipe.name}</h2>
          {recipe.description && <p>{recipe.description}</p>}
          <dl className="recipe-detail-meta">
            {recipe.prep_minutes !== null && <div><dt>Prep</dt><dd>{recipe.prep_minutes} min</dd></div>}
            {recipe.cook_minutes !== null && <div><dt>Cook</dt><dd>{recipe.cook_minutes} min</dd></div>}
            {minutes !== null && <div><dt>Total</dt><dd>{minutes} min</dd></div>}
            {recipe.servings !== null && <div><dt>Serves</dt><dd>{recipe.servings}</dd></div>}
            <div><dt>Difficulty</dt><dd>{titleCase(recipe.difficulty_level)}</dd></div>
          </dl>
        </div>
        <button className="recipe-detail-close" type="button" onClick={onClose} aria-label="Close recipe"><X aria-hidden="true" /></button>
      </header>

      <div className="recipe-detail-body">
        <div className="recipe-detail-columns">
          <section className="recipe-detail-section ingredients-panel">
            <div className="detail-section-heading"><h3>Ingredients</h3><span>{recipe.ingredients.length}</span></div>
            {recipe.ingredients.length > 0 ? (
              <ol>
                {recipe.ingredients.map((ingredient) => (
                  <li key={ingredient.id}>
                    <span>{ingredientQuantity(ingredient)}</span>
                    <div><strong>{ingredient.name}</strong>{ingredient.notes && <small>{ingredient.notes}</small>}</div>
                  </li>
                ))}
              </ol>
            ) : <p>No ingredients have been recorded.</p>}
          </section>

          {recipe.instructions && (
            <section className="recipe-detail-section method-panel">
              <div className="detail-section-heading"><h3>Method</h3><span>{steps.length} {steps.length === 1 ? "step" : "steps"}</span></div>
              <ol>{steps.map((step, index) => <li key={`${index}-${step.slice(0, 20)}`}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
            </section>
          )}
        </div>

        {recipe.notes && <section className="recipe-notes"><h3>Cook's notes</h3><p>{recipe.notes}</p></section>}
        {recipe.tags.length > 0 && <div className="recipe-detail-tags">{recipe.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        {recipe.nutrition && <NutritionPanel nutrition={recipe.nutrition} />}
        {recipe.ai_suggestions && <section className="recipe-notes"><h3>Saved suggestions</h3><p>{recipe.ai_suggestions}</p></section>}

        {recipe.images.length > 1 && (
          <section className="recipe-gallery">
            <div className="detail-section-heading"><h3>Kitchen photos</h3><span>{recipe.images.length}</span></div>
            <div>{recipe.images.slice(1).map((image) => <RecipeImageView key={image.id ?? image.blob_id} image={image} />)}</div>
          </section>
        )}
      </div>

      <footer className="recipe-dialog-actions">
        {recipe.source_url && <a className="button button-quiet source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Original source<ExternalLink aria-hidden="true" /></a>}
        <span className="dialog-action-spacer" />
        <button className="button button-quiet danger-button" type="button" onClick={onDelete}><Trash2 aria-hidden="true" />Delete</button>
        <button className="button button-primary" type="button" onClick={onEdit}><Pencil aria-hidden="true" />Edit recipe</button>
      </footer>
    </dialog>
  );
}

export function RecipeManagerPage() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [legacyImported, setLegacyImported] = useState(false);
  const [aiProvider, setAiProvider] = useState<{ configured: boolean; provider: string }>({
    configured: false,
    provider: "unconfigured"
  });
  const [aiImportOpen, setAiImportOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState<RecipeDraft | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [mealFilter, setMealFilter] = useState("all");
  const [carbFilter, setCarbFilter] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState<RecipeDetail | "new" | null>(null);
  const [viewing, setViewing] = useState<RecipeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const aiRequest = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const response = await api<{
        data: RecipeSummary[];
        meta: {
          legacy_imported: boolean;
          ai: { configured: boolean; provider: string };
        };
      }>("/api/recipes/collection");
      setRecipes(response.data);
      setLegacyImported(response.meta.legacy_imported);
      setAiProvider(response.meta.ai);
      setLoadState("ready");
    } catch (error) {
      setLoadError(apiMessage(error));
      setLoadState("error");
    }
  };

  useEffect(() => { void load(); }, []);

  const filteredRecipes = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return recipes.filter((recipe) => {
      const matchesSearch = !query || [
        recipe.name,
        recipe.description ?? "",
        recipe.cuisine_type ?? "",
        ...recipe.tags
      ].some((value) => value.toLocaleLowerCase().includes(query));
      const matchesMeal = mealFilter === "all" || recipe.meal_type === mealFilter;
      const carbs = netCarbs(recipe);
      const matchesCarbs = carbFilter === "all"
        || (carbs !== null && carbs <= Number(carbFilter));
      return matchesSearch && matchesMeal && matchesCarbs && (!favoritesOnly || recipe.is_favorite);
    });
  }, [carbFilter, favoritesOnly, mealFilter, recipes, searchTerm]);

  const hasFilters = Boolean(searchTerm || mealFilter !== "all" || carbFilter !== "all" || favoritesOnly);

  const fetchDetail = async (id: string): Promise<RecipeDetail> => {
    const response = await api<{ data: RecipeDetail }>(`/api/recipes/collection/${id}`);
    return response.data;
  };

  const openRecipe = async (recipe: RecipeSummary, mode: "view" | "edit") => {
    const request = ++detailRequest.current;
    setActionError(null);
    try {
      const detail = await fetchDetail(recipe.id);
      if (request !== detailRequest.current) return;
      if (mode === "view") setViewing(detail);
      else {
        setAiDraft(null);
        setEditing(detail);
      }
    } catch (error) {
      if (request === detailRequest.current) setActionError(apiMessage(error));
    }
  };

  const openNewRecipe = () => {
    detailRequest.current += 1;
    setViewing(null);
    setActionError(null);
    setAiDraft(null);
    setEditing("new");
  };

  const openAiImport = () => {
    detailRequest.current += 1;
    setViewing(null);
    setAiError(null);
    aiRequest.current = null;
    setAiImportOpen(true);
  };

  const extractAiDraft = async (mode: AiImportMode, value: string) => {
    setAiBusy(true);
    setAiError(null);
    const fingerprint = `${mode}\0${value}`;
    if (aiRequest.current?.fingerprint !== fingerprint) {
      aiRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const response = await api<{ data: RecipePayload; meta: { provider: string; saved: false } }>(
        `/api/recipes/ai/${mode === "text" ? "extract-text" : "extract-url"}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": aiRequest.current.key },
          body: JSON.stringify(mode === "text" ? { text: value } : { url: value })
        }
      );
      setAiDraft(payloadDraft(response.data));
      aiRequest.current = null;
      setAiImportOpen(false);
      setEditing("new");
    } catch (error) {
      setAiError(apiMessage(error));
    } finally {
      setAiBusy(false);
    }
  };

  const saveRecipe = async (payload: RecipePayload) => {
    setBusy(true);
    setActionError(null);
    try {
      const existing = editing !== "new" && editing !== null ? editing : null;
      await api<{ data: RecipeDetail }>(
        existing ? `/api/recipes/collection/${existing.id}` : "/api/recipes/collection",
        {
          method: existing ? "PUT" : "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(payload)
        }
      );
      setEditing(null);
      setAiDraft(null);
      setNotice(existing ? "Recipe updated." : "Recipe added to your collection.");
      await load();
    } catch (error) {
      setActionError(apiMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async (recipe: RecipeSummary) => {
    setFavoriteId(recipe.id);
    setActionError(null);
    try {
      const response = await api<{ data: RecipeSummary }>(`/api/recipes/collection/${recipe.id}/favorite`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ is_favorite: !recipe.is_favorite })
      });
      setRecipes((current) => current.map((item) => item.id === recipe.id ? response.data : item));
      setViewing((current) => current?.id === recipe.id ? { ...current, is_favorite: response.data.is_favorite } : current);
    } catch (error) {
      setActionError(apiMessage(error));
    } finally {
      setFavoriteId(null);
    }
  };

  const deleteRecipe = async (recipe: RecipeSummary) => {
    if (!window.confirm(`Delete “${recipe.name}”? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/recipes/collection/${recipe.id}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() }
      });
      setViewing(null);
      setEditing(null);
      setNotice("Recipe deleted.");
      await load();
    } catch (error) {
      setActionError(apiMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm("");
    setMealFilter("all");
    setCarbFilter("all");
    setFavoritesOnly(false);
  };

  return (
    <main className="work-field recipe-manager">
      <PageHero
        title="What you cook"
        accentPhrase="cook"
        subtitle="Your recipe collection, with AI-assisted imports and the ingredients, timing, nutrition, notes, and kitchen photos that make each dish repeatable."
        actions={
          <>
            <button className="button button-quiet" type="button" onClick={openAiImport} disabled={loadState === "loading"}><Sparkles aria-hidden="true" />Add with AI</button>
            <button className="button button-primary" type="button" onClick={openNewRecipe}><Plus aria-hidden="true" />Add recipe</button>
          </>
        }
      />

      <section className="recipe-tools" aria-label="Find recipes">
        <label className="recipe-search">
          <span className="sr-only">Search recipes</span>
          <Search aria-hidden="true" />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search recipes, cuisines, or tags" />
          {searchTerm && <button type="button" onClick={() => setSearchTerm("")} aria-label="Clear recipe search"><X aria-hidden="true" /></button>}
        </label>
        <div className="recipe-filters">
          <SlidersHorizontal aria-hidden="true" />
          <label><span>Meal</span><select value={mealFilter} onChange={(event) => setMealFilter(event.target.value)}><option value="all">All meals</option>{mealTypes.map((meal) => <option key={meal} value={meal}>{titleCase(meal)}</option>)}</select></label>
          <label><span>Net carbs</span><select value={carbFilter} onChange={(event) => setCarbFilter(event.target.value)}><option value="all">Any amount</option><option value="15">15g or less</option><option value="30">30g or less</option></select></label>
          <button className={`favorite-filter${favoritesOnly ? " is-active" : ""}`} type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((current) => !current)}><Heart aria-hidden="true" />Favorites</button>
        </div>
      </section>

      {(actionError || notice) && (
        <div className={`recipe-notice${actionError ? " is-error" : ""}`} role={actionError ? "alert" : "status"}>
          <span>{actionError ?? notice}</span>
          <button type="button" onClick={() => { setActionError(null); setNotice(null); }} aria-label="Dismiss message"><X aria-hidden="true" /></button>
        </div>
      )}

      <div className="recipe-results-heading">
        <div>
          <h2>{loadState === "loading" ? "Opening your recipe box" : `${filteredRecipes.length} ${filteredRecipes.length === 1 ? "recipe" : "recipes"}`}</h2>
          {loadState === "ready" && recipes.length > 0 && <p>{hasFilters ? `Filtered from ${recipes.length} saved recipes.` : "Recently added recipes appear first."}</p>}
        </div>
        {hasFilters && <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button>}
      </div>

      {loadState === "loading" && <div className="recipe-grid" aria-label="Loading recipes">{[0, 1, 2].map((item) => <div className="recipe-card recipe-card-skeleton" key={item}><i /><span /><span /><span /></div>)}</div>}
      {loadState === "error" && (
        <section className="recipe-empty-state is-error" role="alert">
          <BookOpen aria-hidden="true" />
          <div><h2>The recipe box could not be opened</h2><p>{loadError}</p><button className="button button-primary" type="button" onClick={() => void load()}>Try again</button></div>
        </section>
      )}
      {loadState === "ready" && recipes.length === 0 && (
        <section className="recipe-empty-state">
          <BookOpen aria-hidden="true" />
          <div>
            <h2>{legacyImported ? "Your recipe box is empty" : "Your recipes have not been brought over yet"}</h2>
            <p>{legacyImported
              ? "Add the first household recipe with its ingredients, timing, and notes."
              : "This household has no completed legacy import. An approved import will preserve recipe details and photos, or you can start a new recipe here."}</p>
            <div className="recipe-empty-actions">
              <button className="button button-quiet" type="button" onClick={openAiImport}><Sparkles aria-hidden="true" />Add with AI</button>
              <button className="button button-primary" type="button" onClick={openNewRecipe}><Plus aria-hidden="true" />Add recipe</button>
            </div>
          </div>
        </section>
      )}
      {loadState === "ready" && recipes.length > 0 && filteredRecipes.length === 0 && (
        <section className="recipe-empty-state compact">
          <Search aria-hidden="true" />
          <div><h2>No recipes match those filters</h2><p>Try a broader search, meal type, or carb range.</p><button className="text-button" type="button" onClick={clearFilters}>Show every recipe</button></div>
        </section>
      )}
      {loadState === "ready" && filteredRecipes.length > 0 && (
        <section className="recipe-grid" aria-label="Recipe collection">
          {filteredRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              busyFavorite={favoriteId === recipe.id}
              onOpen={() => void openRecipe(recipe, "view")}
              onEdit={() => void openRecipe(recipe, "edit")}
              onDelete={() => void deleteRecipe(recipe)}
              onFavorite={() => void toggleFavorite(recipe)}
            />
          ))}
        </section>
      )}

      {aiImportOpen && (
        <RecipeAiImportDialog
          configured={aiProvider.configured}
          provider={aiProvider.provider}
          busy={aiBusy}
          error={aiError}
          onClose={() => { if (!aiBusy) { aiRequest.current = null; setAiImportOpen(false); setAiError(null); } }}
          onExtract={(mode, value) => void extractAiDraft(mode, value)}
        />
      )}
      {editing && (
        <RecipeEditor
          key={editing === "new" ? aiDraft ? `ai-${aiDraft.name}` : "new" : editing.id}
          recipe={editing === "new" ? null : editing}
          {...(aiDraft ? { initialDraft: aiDraft } : {})}
          aiAssisted={editing === "new" && Boolean(aiDraft)}
          busy={busy}
          error={actionError}
          onClose={() => { if (!busy) { setEditing(null); setAiDraft(null); setActionError(null); } }}
          onSave={(payload) => void saveRecipe(payload)}
        />
      )}
      {viewing && (
        <RecipeDetailDialog
          recipe={viewing}
          busy={busy || favoriteId === viewing.id}
          onClose={() => setViewing(null)}
          onEdit={() => { setAiDraft(null); setEditing(viewing); setViewing(null); }}
          onDelete={() => void deleteRecipe(viewing)}
          onFavorite={() => void toggleFavorite(viewing)}
        />
      )}
    </main>
  );
}
