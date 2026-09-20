import { state, remote } from "./state.js";
import { remoteReady } from "./auth.js";
import { slugifyTrip, showToast } from "./utils.js";

export function remoteLocationFromRow(row) {
  return {
    region: row.region || "",
    city: row.city || "",
    store: row.store || "",
    location: row.location || "",
    mapsUrl: row.maps_url || "",
    lat: row.lat,
    lng: row.lng
  };
}

export function remoteTripFromRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    primaryLocation: row.primary_location || "",
    persisted: true
  };
}

export function remoteTripDetailFromRow(row) {
  const attraction = String(row.attraction || "");
  const attractionParts = attraction.split("｜");
  const transportDetailRaw = String(row.transport_detail || "");
  let packedTransport = {};
  if (transportDetailRaw.startsWith("{")) {
    try {
      packedTransport = JSON.parse(transportDetailRaw);
    } catch (error) {
      packedTransport = {};
    }
  }
  return {
    id: row.id,
    tripId: row.trip_id,
    date: row.date || row.start_date || "",
    location: row.location || (attractionParts.length > 1 ? attractionParts.shift() : ""),
    period: row.period || packedTransport.period || "",
    time: row.time || packedTransport.time || "",
    activity: row.activity || (attractionParts.length > 1 ? attractionParts.join("｜") : attraction),
    route: row.route || packedTransport.route || transportDetailRaw,
    transport: row.transport || row.transport_type || "",
    attraction: row.attraction || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    transportType: row.transport_type || "",
    transportDetail: row.transport_detail || "",
    cost: Number(row.cost || 0),
    currency: row.currency || "JPY",
    sortOrder: Number(row.sort_order || 0)
  };
}

export function remoteProductFromRow(row) {
  return {
    id: row.id,
    locationId: row.location_id || "",
    tripId: row.trip_id || "",
    trip: row.trip || "",
    nameJa: row.name_ja || "",
    nameZh: row.name_zh || "",
    description: row.description || "",
    qty: row.qty,
    unitPrice: Number(row.unit_price || 0),
    currency: row.currency || "JPY",
    image: row.image_url || "",
    status: row.status || "pending"
  };
}

export function ensureTripsFromProducts(products = state.products) {
  const known = new Map((state.trips || []).map((trip) => [trip.name, trip]));
  (products || []).forEach((product) => {
    if (!product.trip || known.has(product.trip)) return;
    const trip = {
      id: slugifyTrip(product.trip),
      name: product.trip,
      startDate: "",
      endDate: "",
      primaryLocation: product.region || "",
      fallback: true
    };
    known.set(trip.name, trip);
  });
  state.trips = Array.from(known.values());
  const tripIds = new Map(state.trips.map((trip) => [trip.name, trip.id]));
  (products || []).forEach((product) => {
    if (!product.tripId && product.trip) product.tripId = tripIds.get(product.trip) || "";
  });
}

export async function loadTripsFromJson() {
  try {
    const [tripResponse, detailResponse] = await Promise.all([
      fetch("data/trips.json"),
      fetch("data/trip-details.json")
    ]);
    if (!tripResponse.ok || !detailResponse.ok) return [];
    const tripData = await tripResponse.json();
    const detailData = await detailResponse.json();
    state.trips = tripData.trips || [];
    state.tripDetails = detailData.details || [];
    try {
      const savedTrips = JSON.parse(localStorage.getItem("tripcart-trips") || "null");
      const savedDetails = JSON.parse(localStorage.getItem("tripcart-trip-details") || "null");
      if (Array.isArray(savedTrips)) state.trips = savedTrips;
      if (Array.isArray(savedDetails)) state.tripDetails = savedDetails;
    } catch (error) {
      console.warn("Unable to read local trip data", error);
    }
    return state.trips;
  } catch (error) {
    state.trips = [];
    state.tripDetails = [];
    return [];
  }
}

export async function loadRemoteProducts() {
  const [locationResult, productResult] = await Promise.all([
    remote.client.from("locations").select("id,region,city,store,location,maps_url,lat,lng").order("store"),
    remote.client.from("products").select("id,location_id,trip_id,trip,name_ja,name_zh,description,qty,unit_price,currency,image_url,status").order("created_at", { ascending: false })
  ]);
  if (locationResult.error) throw locationResult.error;
  if (productResult.error) throw productResult.error;

  const locationMap = Object.fromEntries(
    (locationResult.data || []).map((location) => [location.id, remoteLocationFromRow(location)])
  );
  const products = (productResult.data || []).map((product) => Object.assign(
    {},
    remoteProductFromRow(product),
    locationMap[product.location_id] || {}
  ));

  try {
    const [tripResult, detailResult] = await Promise.all([
      remote.client.from("trips").select("id,name,start_date,end_date,primary_location").order("start_date", { ascending: true }),
      remote.client.from("trip_details").select("id,trip_id,attraction,start_date,end_date,transport_type,transport_detail,cost,currency,sort_order").order("sort_order", { ascending: true })
    ]);
    if (!tripResult.error && !detailResult.error) {
      state.trips = (tripResult.data || []).map(remoteTripFromRow);
      state.tripDetails = (detailResult.data || []).map(remoteTripDetailFromRow);
      remote.tripDataLoaded = true;
    } else {
      remote.tripDataLoaded = false;
      ensureTripsFromProducts(products);
    }
  } catch (error) {
    remote.tripDataLoaded = false;
    ensureTripsFromProducts(products);
  }
  ensureTripsFromProducts(products);
  return products;
}

export async function refreshRemoteProducts(message, onUpdated = () => {}) {
  if (!remoteReady()) return;
  try {
    state.products = await loadRemoteProducts();
    onUpdated();
    if (message) showToast(message, "good");
  } catch (error) {
    console.error(error);
    if (message) showToast("共享資料同步失敗，請稍後再試。", "warn");
  }
}

export function subscribeToRemoteChanges(onRefresh) {
  if (!remoteReady()) return;
  remote.channel = remote.client
    .channel("tripcart-shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, onRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, onRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, onRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_details" }, onRefresh)
    .subscribe();
}

export async function loadProductsFromJson() {
  const responses = await Promise.all([
    fetch("data/locations.json"),
    fetch("data/products.json")
  ]);
  if (!responses[0].ok || !responses[1].ok) throw new Error("JSON 資料載入失敗");

  const locations = (await responses[0].json()).locations || [];
  const products = (await responses[1].json()).products || [];
  const locationMap = Object.fromEntries(locations.map((location) => [location.id, location]));
  const canonicalProducts = products.map((product) => {
    const locationDetails = Object.assign({}, locationMap[product.locationId] || {});
    delete locationDetails.id;
    return Object.assign({}, product, locationDetails);
  });
  const canonicalById = new Map(canonicalProducts.map((product) => [product.id, product]));

  try {
    const saved = localStorage.getItem("tripcart-products");
    if (saved) {
      const savedProducts = JSON.parse(saved);
      if (Array.isArray(savedProducts)) {
        const normalizedProducts = savedProducts.map((product) => {
          const canonicalProduct = canonicalById.get(product.id);
          const image = typeof product.image === "string" && product.image.startsWith("https://res.cloudinary.com/")
            ? product.image
            : canonicalProduct?.image || "";
          return Object.assign({}, canonicalProduct || {}, product, { image });
        });
        localStorage.setItem("tripcart-products", JSON.stringify(normalizedProducts));
        ensureTripsFromProducts(normalizedProducts);
        return normalizedProducts;
      }
    }
  } catch (error) {
    console.warn("Unable to read local product data", error);
  }

  ensureTripsFromProducts(canonicalProducts);
  return canonicalProducts;
}

export async function loadProducts() {
  if (remoteReady()) {
    try {
      return await loadRemoteProducts();
    } catch (error) {
      console.warn("Unable to load shared Supabase data; using local seed data", error);
      showToast("共享資料暫時無法讀取，先顯示本地初始資料。", "warn");
    }
  }
  return loadProductsFromJson();
}

export function saveProducts() {
  try {
    localStorage.setItem("tripcart-products", JSON.stringify(state.products));
  } catch (error) {
    console.warn("Unable to save local product data", error);
  }
}

export function saveTripsLocally() {
  try {
    localStorage.setItem("tripcart-trips", JSON.stringify(state.trips));
    localStorage.setItem("tripcart-trip-details", JSON.stringify(state.tripDetails));
  } catch (error) {
    console.warn("Unable to save local trip data", error);
  }
}

export async function saveProductToRemote(data) {
  const existingLocation = state.products.find((product) => product.locationId === data.locationId);
  const matchingLocation = state.products.find((product) =>
    product.locationId &&
    product.location === data.location &&
    product.mapsUrl === data.mapsUrl &&
    product.region === data.region
  );
  const locationId = data.locationId || matchingLocation?.locationId || "location-" + Date.now();
  const selectedTrip = state.trips.find((trip) => trip.id === data.tripId);
  const tripId = selectedTrip?.fallback ? null : (data.tripId || null);
  const locationRow = {
    id: locationId,
    region: data.region,
    city: data.region,
    store: existingLocation?.store || matchingLocation?.store || data.location,
    location: data.location,
    maps_url: data.mapsUrl,
    lat: data.lat,
    lng: data.lng
  };
  const { error: locationError } = await remote.client.from("locations").upsert(locationRow);
  if (locationError) throw locationError;

  const productRow = {
    id: data.id,
    location_id: locationId,
    trip_id: tripId,
    trip: data.trip,
    name_ja: data.nameJa,
    name_zh: "",
    description: data.description,
    qty: data.qty,
    unit_price: data.unitPrice,
    currency: data.currency,
    image_url: data.image,
    status: data.status
  };
  const { error: productError } = await remote.client.from("products").upsert(productRow);
  if (productError) throw productError;
  return locationId;
}

export async function saveTripToRemote(trip, details) {
  const tripRow = {
    id: trip.id,
    name: trip.name,
    start_date: trip.startDate || null,
    end_date: trip.endDate || null,
    primary_location: trip.primaryLocation
  };
  const { error: tripError } = await remote.client.from("trips").upsert(tripRow);
  if (tripError) throw tripError;

  const { error: productError } = await remote.client
    .from("products")
    .update({ trip: trip.name })
    .eq("trip_id", trip.id);
  if (productError) throw productError;

  const { error: deleteError } = await remote.client.from("trip_details").delete().eq("trip_id", trip.id);
  if (deleteError) throw deleteError;

  const rows = details
    .filter((detail) => detail.activity || detail.location || detail.transport || detail.route || detail.cost)
    .map((detail, index) => ({
      id: detail.id || "detail-" + Date.now() + "-" + index,
      trip_id: trip.id,
      // Keep the current Supabase schema compatible while the editor uses the
      // spreadsheet-shaped fields. The location is kept beside the activity.
      attraction: detail.location && detail.activity
        ? detail.location + "｜" + detail.activity
        : (detail.activity || detail.location || detail.attraction || ""),
      start_date: detail.date || detail.startDate || null,
      end_date: detail.date || detail.endDate || null,
      transport_type: detail.transport || detail.transportType || "",
      transport_detail: detail.period || detail.time
        ? JSON.stringify({
            route: detail.route || detail.transportDetail || "",
            period: detail.period || "",
            time: detail.time || ""
          })
        : (detail.route || detail.transportDetail || ""),
      cost: Number(detail.cost || 0),
      currency: detail.currency || "JPY",
      sort_order: index
    }));
  if (rows.length) {
    const { error: detailError } = await remote.client.from("trip_details").insert(rows);
    if (detailError) throw detailError;
  }
}
