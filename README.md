# HarvestIQ

HarvestIQ is a local dashboard for exploring agricultural market prices and viewing short-term price estimates. You can use the included demo data or import a CSV file, choose a commodity and market, compare forecasting models, and export the forecast.

> **Please note:** The included demo prices are synthetic examples, not live or official mandi prices. Forecasts are estimates and are not guarantees. Check current local rates and official sources before making buying or selling decisions.

## Start the app

You need **Node.js 18 or newer** and npm.

1. Download and extract the project.
2. Open a terminal in the extracted project folder. The folder can have any name.
3. Run:

   ```bash
   npm i express
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.
5. To stop the app, return to the terminal and press **Ctrl+C**.

If port 3000 is already in use, set the `PORT` environment variable to another available port before running `npm start`.

## Use the dashboard

When the page opens, it loads the bundled synthetic demo dataset. Use the controls to:

- Choose a **commodity**.
- Choose a **market**, or choose **All markets** to see the average price across the available markets.
- Select a forecast horizon of **7, 14, 30, or 60 days**.
- Select a forecasting model.

The dashboard updates when you change a selection. It shows the latest historical price, forecast average, estimated price change, historical chart, model comparison, market summary, and day-by-day forecast. Use **Export CSV** to download the forecast.

### Forecasting choices

- **Smart Ensemble** averages the predictions from the other three models.
- **Ridge ML** looks at recent prices and their patterns. With very short histories, it falls back to Moving Average.
- **Linear Regression** extends a straight-line trend fitted to the historical prices.
- **Moving Average** uses recent prices and a limited recent trend.

The model comparison shows recent holdout scores:

- **MAE** is the average size of prediction errors; lower is better.
- **RMSE** gives larger errors more weight; lower is better.
- **MAPE** shows average error as a percentage; lower is better.

These scores describe past test predictions. They do not promise that a model will be accurate for future prices. The estimated range around forecasts is also approximate, not a guaranteed range of outcomes.

## Import your own CSV

Use **Import data** at the top of the page, or drop a CSV file into the dataset area. The file must be **25 MB or smaller**. Importing replaces the current dataset in the dashboard.

The recommended columns are:

```csv
Arrival_Date,Commodity,Market,Min_Price,Max_Price,Modal_Price
2025-01-01,Tomato,Azadpur,2410,2800,2590
```

The app recognizes common alternative names for the date, commodity, market, and price columns. It accepts year-first dates such as `2025-01-31` and day-first dates such as `31/01/2025`.

For each row, the app uses a positive modal price when available. Otherwise it derives a price from the minimum and maximum prices, or uses whichever positive bound is available. Rows with an unusable date or price are skipped. If commodity or market names are missing, the app labels them as unspecified.

Your CSV is read in your browser; it is not uploaded to a remote service. The imported data is kept only for the current page session. Refreshing the page returns to the bundled demo dataset, so keep your original CSV if you need it later.

## How the app works

The local Node.js server opens the dashboard and provides its static files. The browser loads the sample CSV or reads your imported file, filters and groups the prices, calculates forecasts and comparison scores, and draws the charts and tables. The app does not use a database or fetch live mandi prices.

## Troubleshooting

- **The page does not open:** Make sure `npm start` is still running, then try `http://localhost:3000` again.
- **The sample data does not load:** Open the app through the local server address above; do not open `index.html` directly as a file.
- **A CSV import fails:** Check that the file is a CSV, is no larger than 25 MB, and contains a date column plus a usable price column.
- **There are too few observations:** Select a commodity and market with at least three valid dates to display a forecast.
- **Port 3000 is busy:** Stop the other app using it, or start HarvestIQ on another available port using `PORT`.

## Data and forecast limitations

- The bundled prices are for demonstration only.
- Forecasts are generated from the selected history and do not include live market conditions, weather, arrivals, policy changes, or other outside factors.
- The models treat observations as equally spaced. Gaps in dates and market closures are not accounted for, while forecast dates advance by calendar days.
- **All markets** averages available market prices, which can hide differences between individual markets.
