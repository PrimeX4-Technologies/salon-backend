import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { openApiDocument } from "./openapi.js";

const router = Router();

router.get("/openapi.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(openApiDocument);
});

router.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "Salon Booking API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: "none",
      filter: true,
    },
  }),
);

export default router;

