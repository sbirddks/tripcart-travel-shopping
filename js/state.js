export const state = {
  products: [],
  trips: [],
  tripDetails: [],
  trip: "all",
  region: "all",
  search: "",
  editingId: null,
  editingLocationId: "",
  editingTripId: null,
  tripEditorDetails: [],
  imageData: "",
  imageFile: null,
  session: null,
  profile: null
};

export const cloudinary = { config: {} };

export const remote = {
  config: {},
  client: null,
  channel: null,
  tripDataLoaded: false
};
